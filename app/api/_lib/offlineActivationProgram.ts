import crypto from "crypto";

import { getProfile } from "@/app/api/auth/_lib/profile";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  getActiveMembership,
  isApproverForChurch,
  normalizeMembershipChurchId,
} from "@/app/api/_lib/memberships";
import {
  appendOfflineActivationAudit,
  listOfflineActivationAudit,
  type OfflineActivationAuditEvent,
} from "@/app/api/_lib/offlineActivationAudit";
import {
  createSupervisorAgent,
  findSupervisorAgentByLinkedUser,
  isAcceptedAgentStatus,
  listAgentsByLinkedUserId,
  listSupervisorAgents,
  updateAgentRegistrationStatusByInvite,
  type OfflineActivationAgent,
} from "@/app/api/_lib/offlineActivationAgentStore";
import {
  inviteSupervisorByKristoAndChurch,
  resolveUserByKristoId,
} from "@/app/api/_lib/offlineActivationAdmin";
import {
  deletePlatformRole,
  getPlatformRole,
  listPlatformRoleUsers,
  upsertPlatformRole,
  type PlatformRole,
} from "@/app/api/_lib/platformRoles";
import {
  OFFLINE_ACTIVATION_PROGRAM_STORE_KEY,
  readOfflineActivationJsonFile,
  updateOfflineActivationJsonFile,
  withOfflineActivationLock,
} from "@/app/api/_lib/store/offlineActivationDb";
import {
  callProgramFunction,
  dbConsumeAdminLoginCode,
  ProgramDbError,
  readProgramSnapshot,
  useProgramPostgres,
} from "@/app/api/_lib/store/offlineActivationProgramDb";
import { getInvitationById } from "@/app/api/_lib/offlineActivationInvitations";

/**
 * Offline-activation program (Uvumbuzi Lab + Kristo): extends the existing
 * supervisor/agent offline-activation data with
 *  - per-supervisor agent limits set by System Admin,
 *  - expiring, limited-use, revocable agent invite codes,
 *  - church onboarding + training reports submitted by agents,
 *  - in-app leader confirmations kept separate from the agent's report,
 *  - suspend / revoke without deleting history,
 *  - append-only audit history (offlineActivationAudit.ts).
 *
 * Existing documents (codes, agents, invitations, platform roles) are read
 * and extended, never rewritten or migrated destructively.
 */

export class ProgramError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const DEFAULT_SUPERVISOR_AGENT_LIMIT = (() => {
  const raw = Number(process.env.KRISTO_SUPERVISOR_DEFAULT_AGENT_LIMIT);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;
})();
export const MAX_SUPERVISOR_AGENT_LIMIT = 500;
export const INVITE_CODE_DEFAULT_TTL_HOURS = 72;
export const INVITE_CODE_MAX_TTL_HOURS = 720;
export const ADMIN_LOGIN_CODE_TTL_SECONDS = 120;
export const LEADER_CONFIRMATION_QUESTION =
  "Je, agent huyu amekusaidia na kukufundisha kutumia Kristo? Umeelewa?";

export type ProgramMemberStatus = "active" | "suspended" | "revoked";

export type ProgramMember = {
  userId: string;
  role: "Supervisor" | "Agent";
  status: ProgramMemberStatus;
  agentLimit?: number;
  supervisorUserId?: string;
  statusReason?: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
  limitUpdatedAt?: string;
  limitUpdatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentInviteCode = {
  id: string;
  codeHash: string;
  codePreview: string;
  supervisorUserId: string;
  maxUses: number;
  uses: { userId: string; at: string }[];
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
  revokedBy?: string;
};

export type OnboardingStatus =
  | "invited"
  | "registered"
  | "training_pending"
  | "awaiting_confirmation"
  | "confirmed"
  | "needs_help"
  | "rejected";

export type FollowUpStatus = "none" | "scheduled" | "in_progress" | "completed";

export type AgentTrainingReport = {
  trainingTopics: string[];
  trainingNotes: string;
  trainingCompleted: boolean;
  followUpStatus: FollowUpStatus;
  followUpNote: string;
  submittedAt: string;
  version: number;
};

export type LeaderConfirmationResponse = "confirmed" | "rejected" | "needs_help";

export type LeaderConfirmation = {
  requestId: string;
  status: "pending" | LeaderConfirmationResponse;
  question: string;
  requestedAt: string;
  reportVersion: number;
  respondedAt?: string;
  respondedByUserId?: string;
  note?: string;
};

export type ChurchOnboarding = {
  id: string;
  agentUserId: string;
  supervisorUserId: string;
  leaderUserId: string;
  leaderKristoId: string;
  churchId?: string;
  registeredAt?: string;
  status: OnboardingStatus;
  /** Agent's own statement. Never used as proof of confirmation. */
  agentReport: AgentTrainingReport | null;
  /** Leader's answer, recorded only from the leader's own session. */
  leaderConfirmation: LeaderConfirmation | null;
  confirmationHistory: LeaderConfirmation[];
  createdAt: string;
  updatedAt: string;
};

type AdminLoginCode = {
  codeHash: string;
  userId: string;
  expiresAt: string;
  usedAt?: string;
};

type ProgramStore = {
  version: 1;
  members: Record<string, ProgramMember>;
  agentInviteCodes: AgentInviteCode[];
  onboardings: ChurchOnboarding[];
  adminLoginCodes: AdminLoginCode[];
};

const STORE_FILE = OFFLINE_ACTIVATION_PROGRAM_STORE_KEY;

/** One lock for every write that checks or changes limits, codes, teams or churches. */
export const PROGRAM_LOCK = "offline-activation-program";

function emptyStore(): ProgramStore {
  return { version: 1, members: {}, agentInviteCodes: [], onboardings: [], adminLoginCodes: [] };
}

function normalizeStore(raw: Partial<ProgramStore> | null | undefined): ProgramStore {
  const base = emptyStore();
  if (!raw || typeof raw !== "object") return base;
  return {
    version: 1,
    members: raw.members && typeof raw.members === "object" ? { ...raw.members } : {},
    agentInviteCodes: Array.isArray(raw.agentInviteCodes) ? raw.agentInviteCodes.slice() : [],
    onboardings: Array.isArray(raw.onboardings) ? raw.onboardings.slice() : [],
    adminLoginCodes: Array.isArray(raw.adminLoginCodes) ? raw.adminLoginCodes.slice() : [],
  };
}

async function readProgram(): Promise<ProgramStore> {
  if (useProgramPostgres()) return normalizeStore((await readProgramSnapshot()) as unknown as ProgramStore);
  return normalizeStore(await readOfflineActivationJsonFile<ProgramStore>(STORE_FILE, emptyStore()));
}

/** Postgres: one PL/pgSQL call = one transaction; its errors become ProgramErrors. */
async function pgCall<T>(name: string, args: unknown[], types: string[]): Promise<T> {
  try {
    return await callProgramFunction<T>(name, args, types);
  } catch (error) {
    if (error instanceof ProgramDbError) throw new ProgramError(error.status, error.message);
    throw error;
  }
}

async function pgOnboarding(id: string): Promise<ChurchOnboarding> {
  const row = (await readProgram()).onboardings.find((item) => item.id === id);
  if (!row) throw new ProgramError(404, "Onboarding not found");
  return row;
}

async function pgMember(userId: string): Promise<ProgramMember> {
  const member = (await readProgram()).members[userId];
  if (!member) throw new ProgramError(404, "Supervisor or agent not found");
  return member;
}

async function mutateProgram<R>(mutator: (store: ProgramStore) => R): Promise<R> {
  let result: R | undefined;
  await updateOfflineActivationJsonFile<ProgramStore>(
    STORE_FILE,
    (current) => {
      const store = normalizeStore(current);
      result = mutator(store);
      return store;
    },
    emptyStore()
  );
  return result as R;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(`kristo-oact-program:${value}`).digest("hex");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function normalizeCodeInput(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

async function displayName(userId: string): Promise<{ name: string; kristoId: string }> {
  const profile: any = await getProfile(userId).catch(() => null);
  return {
    name: String(profile?.fullName || profile?.displayName || "").trim(),
    kristoId: String(profile?.userCode || "").trim().toUpperCase(),
  };
}

/* =========================
   Access rules
   ========================= */

export type ProgramAccess = {
  userId: string;
  platformRole: PlatformRole;
  member: ProgramMember | null;
  /** For agents: the supervisor resolved from server-side registrations. */
  supervisorUserId?: string;
};

function activeAgentRegistrations(rows: OfflineActivationAgent[]) {
  return rows.filter((row) => isAcceptedAgentStatus(row.status));
}

/** The supervisor an agent works for, from server-side data only. */
export async function resolveAgentSupervisor(agentUserId: string): Promise<string | null> {
  const store = await readProgram();
  const member = store.members[agentUserId];
  if (member?.role === "Agent" && member.supervisorUserId) return member.supervisorUserId;
  const registrations = activeAgentRegistrations(await listAgentsByLinkedUserId(agentUserId));
  if (!registrations.length) return null;
  const latest = registrations
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return latest.supervisorUserId || null;
}

export async function getProgramMember(userId: string): Promise<ProgramMember | null> {
  const store = await readProgram();
  return store.members[String(userId || "").trim()] || null;
}

/**
 * Throws ProgramError(403) when a suspended/revoked member (or an agent of a
 * suspended/revoked supervisor) tries to use the program. Used by the new
 * program routes and by guardPlatformOfflineActivation for legacy routes.
 */
export async function assertProgramMemberAllowed(
  userId: string,
  platformRole: PlatformRole,
  options: { requireAgentRegistration?: boolean } = {}
): Promise<ProgramAccess> {
  const requireAgentRegistration = options.requireAgentRegistration !== false;
  const store = await readProgram();
  const member = store.members[userId] || null;
  if (platformRole === "System_Admin") return { userId, platformRole, member };

  if (member && member.status !== "active") {
    throw new ProgramError(403, `Access ${member.status}`);
  }

  if (platformRole === "Agent") {
    const supervisorUserId = await resolveAgentSupervisor(userId);
    if (!supervisorUserId) {
      if (!requireAgentRegistration) return { userId, platformRole, member };
      throw new ProgramError(403, "No active agent registration");
    }
    const supervisorMember = store.members[supervisorUserId];
    if (supervisorMember && supervisorMember.status !== "active") {
      throw new ProgramError(403, "Supervisor access is not active");
    }
    const supervisorRole = await getPlatformRole(supervisorUserId);
    if (supervisorRole !== "Supervisor" && requireAgentRegistration) {
      throw new ProgramError(403, "Supervisor access is not active");
    }
    return { userId, platformRole, member, supervisorUserId };
  }

  return { userId, platformRole, member };
}

/* =========================
   Supervisor limits
   ========================= */

/**
 * Explicit limit set by System Admin, else the default (5). A supervisor who
 * already had more agents before limits existed keeps that many: the effective
 * limit is never below the agents they already have, and nobody is removed.
 */
export function agentLimitFor(member: ProgramMember | null | undefined, currentAgents = 0): number {
  const raw = Number(member?.agentLimit);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return Math.max(DEFAULT_SUPERVISOR_AGENT_LIMIT, currentAgents);
}

/** Distinct agents that hold (or are invited to) a slot: pending or accepted, not revoked. */
export async function countSupervisorAgentSlots(supervisorUserId: string): Promise<number> {
  const store = await readProgram();
  const agents = await listSupervisorAgents(supervisorUserId);
  const users = new Set<string>();
  for (const agent of agents) {
    if (agent.status !== "pending" && !isAcceptedAgentStatus(agent.status)) continue;
    const uid = String(agent.linkedUserId || agent.kristoId || agent.id);
    if (store.members[uid]?.status === "revoked") continue;
    users.add(uid);
  }
  return users.size;
}

function openCodeSlots(store: ProgramStore, supervisorUserId: string): number {
  const now = Date.now();
  return store.agentInviteCodes
    .filter(
      (code) =>
        code.supervisorUserId === supervisorUserId &&
        !code.revokedAt &&
        Date.parse(code.expiresAt) > now
    )
    .reduce((sum, code) => sum + Math.max(0, code.maxUses - code.uses.length), 0);
}

export async function assertSupervisorHasCapacity(supervisorUserId: string, extra = 1) {
  const store = await readProgram();
  const used = await countSupervisorAgentSlots(supervisorUserId);
  const limit = agentLimitFor(store.members[supervisorUserId], used);
  if (used + extra > limit) {
    throw new ProgramError(409, `Agent limit reached (${used}/${limit})`);
  }
  return { limit, used };
}

/** Legacy Kristo-ID invitations take a slot too, after open invite-code slots. */
export async function assertSupervisorCanInviteAgent(supervisorUserId: string) {
  const store = await readProgram();
  const used = await countSupervisorAgentSlots(supervisorUserId);
  const limit = agentLimitFor(store.members[supervisorUserId], used);
  const reserved = openCodeSlots(store, supervisorUserId);
  if (used + reserved + 1 > limit) {
    throw new ProgramError(
      409,
      `Agent limit reached (${used} agents + ${reserved} open invite slots of ${limit})`
    );
  }
}

function upsertMember(
  store: ProgramStore,
  userId: string,
  role: ProgramMember["role"],
  patch: Partial<ProgramMember>
): ProgramMember {
  const now = nowIso();
  const existing = store.members[userId];
  const base: ProgramMember = existing || { userId, role, status: "active", createdAt: now, updatedAt: now };
  const next: ProgramMember = { ...base, ...patch, userId, role, updatedAt: now };
  store.members[userId] = next;
  return next;
}

/* =========================
   System Admin
   ========================= */

async function adminSetSupervisorLimitUnlocked(input: {
  actorUserId: string;
  supervisorUserId: string;
  agentLimit: number;
}): Promise<ProgramMember> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const limit = Math.floor(Number(input.agentLimit));
  if (!Number.isFinite(limit) || limit < 0 || limit > MAX_SUPERVISOR_AGENT_LIMIT) {
    throw new ProgramError(400, `agentLimit must be 0–${MAX_SUPERVISOR_AGENT_LIMIT}`);
  }
  if (useProgramPostgres()) {
    await pgCall("oact_set_supervisor_limit", [input.actorUserId, supervisorUserId, limit, DEFAULT_SUPERVISOR_AGENT_LIMIT],
      ["text", "text", "int", "int"]);
    return pgMember(supervisorUserId);
  }
  const role = await getPlatformRole(supervisorUserId);
  const existing = await getProgramMember(supervisorUserId);
  if (role !== "Supervisor" && existing?.role !== "Supervisor") {
    throw new ProgramError(404, "Supervisor not found");
  }

  const used = await countSupervisorAgentSlots(supervisorUserId);
  if (limit < used) {
    throw new ProgramError(409, `This supervisor already has ${used} agents; the limit cannot be lower than that`);
  }

  let previous = 0;
  const member = await mutateProgram((store) => {
    previous = agentLimitFor(store.members[supervisorUserId], used);
    return upsertMember(store, supervisorUserId, "Supervisor", {
      agentLimit: limit,
      limitUpdatedAt: nowIso(),
      limitUpdatedBy: input.actorUserId,
    });
  });

  await appendOfflineActivationAudit({
    actorUserId: input.actorUserId,
    actorRole: "System_Admin",
    action: "supervisor.limit_changed",
    targetType: "user",
    targetId: supervisorUserId,
    details: { previous, next: limit },
  });
  return member;
}

async function adminInviteSupervisorUnlocked(input: {
  actorUserId: string;
  kristoId: string;
  churchId: string;
  agentLimit?: number;
}) {
  if (useProgramPostgres()) return pgAdminInviteSupervisor(input);
  const result = await inviteSupervisorByKristoAndChurch(input.kristoId, input.churchId, input.actorUserId);
  const userId = result.user.userId;
  const limit =
    input.agentLimit === undefined || input.agentLimit === null
      ? undefined
      : Math.floor(Number(input.agentLimit));
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 0 || limit > MAX_SUPERVISOR_AGENT_LIMIT)) {
    throw new ProgramError(400, `agentLimit must be 0–${MAX_SUPERVISOR_AGENT_LIMIT}`);
  }
  if (limit !== undefined && limit < (await countSupervisorAgentSlots(userId))) {
    throw new ProgramError(409, "The limit cannot be lower than the agents this supervisor already has");
  }

  await mutateProgram((store) => {
    const existing = store.members[userId];
    upsertMember(store, userId, "Supervisor", {
      ...(limit !== undefined
        ? { agentLimit: limit, limitUpdatedAt: nowIso(), limitUpdatedBy: input.actorUserId }
        : {}),
      status: existing?.status || "active",
    });
  });

  if (result.outcome === "invited") {
    await appendOfflineActivationAudit({
      actorUserId: input.actorUserId,
      actorRole: "System_Admin",
      action: "supervisor.invited",
      targetType: "invitation",
      targetId: result.invitation?.id || userId,
      details: { inviteeUserId: userId, churchId: result.user.churchId, agentLimit: limit ?? null },
    });
  }
  return result;
}

async function adminSetMemberStatusUnlocked(input: {
  actorUserId: string;
  userId: string;
  status: ProgramMemberStatus;
  reason?: string;
}): Promise<ProgramMember> {
  const userId = String(input.userId || "").trim();
  const status = input.status;
  if (status !== "active" && status !== "suspended" && status !== "revoked") {
    throw new ProgramError(400, "status must be active, suspended or revoked");
  }
  if (userId === input.actorUserId) throw new ProgramError(400, "Cannot change your own access");
  if (useProgramPostgres()) {
    await pgCall("oact_set_member_status", [input.actorUserId, userId, status, cleanText(input.reason, 300)],
      ["text", "text", "text", "text"]);
    return pgMember(userId);
  }

  const currentRole = await getPlatformRole(userId);
  const existing = await getProgramMember(userId);
  const role: ProgramMember["role"] | null =
    currentRole === "Supervisor" || currentRole === "Agent"
      ? currentRole
      : existing?.role || null;
  if (!role) throw new ProgramError(404, "Supervisor or agent not found");
  if (currentRole === "System_Admin") throw new ProgramError(400, "System_Admin access is not managed here");

  const previous = existing?.status || "active";
  const reason = cleanText(input.reason, 300);

  if (status === "active" && previous === "revoked") {
    // Reinstating a revoked member restores the platform role; history stays as-is.
    await upsertPlatformRole(userId, role, `Reinstated by ${input.actorUserId}`);
    await appendOfflineActivationAudit({
      actorUserId: input.actorUserId,
      actorRole: "System_Admin",
      action: "role.granted",
      targetType: "user",
      targetId: userId,
      details: { role, reason: "reinstated" },
    });
  }

  const member = await mutateProgram((store) =>
    upsertMember(store, userId, role, {
      status,
      statusReason: reason || undefined,
      statusChangedAt: nowIso(),
      statusChangedBy: input.actorUserId,
    })
  );

  if (status === "revoked" && currentRole) {
    // Removing the role closes every legacy offline-activation route too.
    await deletePlatformRole(userId);
    await appendOfflineActivationAudit({
      actorUserId: input.actorUserId,
      actorRole: "System_Admin",
      action: "role.removed",
      targetType: "user",
      targetId: userId,
      details: { role, reason: reason || null },
    });
  }

  await appendOfflineActivationAudit({
    actorUserId: input.actorUserId,
    actorRole: "System_Admin",
    action: "member.status_changed",
    targetType: "user",
    targetId: userId,
    details: { role, previous, next: status, reason: reason || null },
  });
  return member;
}

/* =========================
   Agent invite codes (Supervisor)
   ========================= */

export type PublicInviteCode = Omit<AgentInviteCode, "codeHash" | "uses"> & {
  usedCount: number;
  state: "active" | "expired" | "revoked" | "used_up";
};

function publicCode(code: AgentInviteCode): PublicInviteCode {
  const { codeHash: _hash, uses, ...rest } = code;
  const state: PublicInviteCode["state"] = code.revokedAt
    ? "revoked"
    : Date.parse(code.expiresAt) <= Date.now()
      ? "expired"
      : uses.length >= code.maxUses
        ? "used_up"
        : "active";
  return { ...rest, usedCount: uses.length, state };
}

async function createAgentInviteCodeUnlocked(input: {
  supervisorUserId: string;
  maxUses?: number;
  expiresInHours?: number;
}): Promise<{ code: string; invite: PublicInviteCode }> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const maxUses = Math.floor(Number(input.maxUses ?? 1));
  const ttlHours = Number(input.expiresInHours ?? INVITE_CODE_DEFAULT_TTL_HOURS);
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 50) {
    throw new ProgramError(400, "maxUses must be 1–50");
  }
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > INVITE_CODE_MAX_TTL_HOURS) {
    throw new ProgramError(400, `expiresInHours must be within 1–${INVITE_CODE_MAX_TTL_HOURS}`);
  }

  const code = `AG-${randomCode(4)}-${randomCode(4)}`;
  if (useProgramPostgres()) {
    const id = newId("oactcode");
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    await pgCall("oact_create_invite_code",
      [supervisorUserId, id, hashSecret(normalizeCodeInput(code)), code.slice(-4), maxUses, expiresAt, DEFAULT_SUPERVISOR_AGENT_LIMIT],
      ["text", "text", "text", "text", "int", "timestamptz", "int"]);
    const row = (await readProgram()).agentInviteCodes.find((item) => item.id === id)!;
    return { code, invite: publicCode(row) };
  }
  const used = await countSupervisorAgentSlots(supervisorUserId);
  const record = await mutateProgram((store) => {
    const limit = agentLimitFor(store.members[supervisorUserId], used);
    const reserved = openCodeSlots(store, supervisorUserId);
    if (used + reserved + maxUses > limit) {
      throw new ProgramError(
        409,
        `Agent limit reached (${used} agents + ${reserved} open invite slots of ${limit})`
      );
    }
    const row: AgentInviteCode = {
      id: newId("oactcode"),
      codeHash: hashSecret(normalizeCodeInput(code)),
      codePreview: code.slice(-4),
      supervisorUserId,
      maxUses,
      uses: [],
      expiresAt: new Date(Date.now() + ttlHours * 3600_000).toISOString(),
      createdAt: nowIso(),
      createdBy: supervisorUserId,
    };
    store.agentInviteCodes.push(row);
    return row;
  });

  await appendOfflineActivationAudit({
    actorUserId: supervisorUserId,
    actorRole: "Supervisor",
    action: "invite_code.created",
    targetType: "invite_code",
    targetId: record.id,
    details: { maxUses, expiresAt: record.expiresAt, preview: record.codePreview },
  });

  return { code, invite: publicCode(record) };
}

async function revokeAgentInviteCodeUnlocked(input: {
  actorUserId: string;
  actorRole: "Supervisor" | "System_Admin";
  codeId: string;
}): Promise<PublicInviteCode> {
  const codeId = String(input.codeId || "").trim();
  if (useProgramPostgres()) {
    await pgCall("oact_revoke_invite_code", [input.actorUserId, input.actorRole, codeId], ["text", "text", "text"]);
    return publicCode((await readProgram()).agentInviteCodes.find((item) => item.id === codeId)!);
  }
  const record = await mutateProgram((store) => {
    const row = store.agentInviteCodes.find((code) => code.id === codeId);
    // Another supervisor's code is indistinguishable from a missing one.
    if (!row || (input.actorRole === "Supervisor" && row.supervisorUserId !== input.actorUserId)) {
      throw new ProgramError(404, "Invite code not found");
    }
    if (!row.revokedAt) {
      row.revokedAt = nowIso();
      row.revokedBy = input.actorUserId;
    }
    return { ...row };
  });

  await appendOfflineActivationAudit({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: "invite_code.revoked",
    targetType: "invite_code",
    targetId: record.id,
  });
  return publicCode(record);
}

/** Simple per-user throttle so invite codes cannot be guessed. */
const redeemAttempts = new Map<string, number[]>();
const REDEEM_WINDOW_MS = 10 * 60_000;
const REDEEM_MAX_ATTEMPTS = 10;

function checkRedeemThrottle(userId: string) {
  const now = Date.now();
  const recent = (redeemAttempts.get(userId) || []).filter((t) => now - t < REDEEM_WINDOW_MS);
  if (recent.length >= REDEEM_MAX_ATTEMPTS) {
    throw new ProgramError(429, "Too many attempts. Try again later.");
  }
  recent.push(now);
  redeemAttempts.set(userId, recent);
}

export function resetRedeemThrottleForTests() {
  redeemAttempts.clear();
}

async function redeemAgentInviteCodeUnlocked(input: {
  userId: string;
  code: string;
}): Promise<{ agent: OfflineActivationAgent; supervisorUserId: string }> {
  const userId = String(input.userId || "").trim();
  const normalized = normalizeCodeInput(input.code);
  if (!userId) throw new ProgramError(401, "Unauthorized");
  if (normalized.length < 8) throw new ProgramError(400, "Invalid invite code");
  checkRedeemThrottle(userId);

  const codeHash = hashSecret(normalized);
  if (useProgramPostgres()) return pgRedeem(userId, codeHash);
  const store = await readProgram();
  const row = store.agentInviteCodes.find((code) => code.codeHash === codeHash);
  if (!row) throw new ProgramError(404, "Invite code not found");
  if (row.revokedAt) throw new ProgramError(410, "Invite code was revoked");
  if (Date.parse(row.expiresAt) <= Date.now()) throw new ProgramError(410, "Invite code has expired");
  if (row.uses.length >= row.maxUses) throw new ProgramError(410, "Invite code has been used");
  if (row.supervisorUserId === userId) throw new ProgramError(400, "You cannot redeem your own invite code");

  const supervisorUserId = row.supervisorUserId;
  const supervisorRole = await getPlatformRole(supervisorUserId);
  const supervisorMember = store.members[supervisorUserId];
  if (supervisorRole !== "Supervisor" || (supervisorMember && supervisorMember.status !== "active")) {
    throw new ProgramError(410, "Invite code is no longer valid");
  }

  const existingRole = await getPlatformRole(userId);
  if (existingRole === "System_Admin" || existingRole === "Supervisor") {
    throw new ProgramError(409, `You already have the ${existingRole} role`);
  }
  const existingMember = store.members[userId];
  if (existingMember && existingMember.status !== "active") {
    throw new ProgramError(403, `Access ${existingMember.status}`);
  }
  const currentSupervisor = existingRole === "Agent" ? await resolveAgentSupervisor(userId) : null;
  if (currentSupervisor && currentSupervisor !== supervisorUserId) {
    throw new ProgramError(409, "You already work with another supervisor");
  }
  if (currentSupervisor === supervisorUserId) {
    throw new ProgramError(409, "You are already an agent of this supervisor");
  }

  const active = await getActiveMembership(userId);
  const churchId = normalizeMembershipChurchId(active?.churchId);
  if (!active || !churchId) {
    throw new ProgramError(400, "Join your church in Kristo before becoming an agent");
  }

  // The code reserved this slot when it was created; re-check against real agents now.
  await assertSupervisorHasCapacity(supervisorUserId, 1);

  // Claim one use atomically before creating the registration.
  await mutateProgram((current) => {
    const live = current.agentInviteCodes.find((code) => code.id === row.id);
    if (!live || live.revokedAt || Date.parse(live.expiresAt) <= Date.now()) {
      throw new ProgramError(410, "Invite code is no longer valid");
    }
    if (live.uses.length >= live.maxUses) throw new ProgramError(410, "Invite code has been used");
    if (live.uses.some((use) => use.userId === userId)) {
      throw new ProgramError(409, "Invite code already redeemed by you");
    }
    live.uses.push({ userId, at: nowIso() });
    upsertMember(current, userId, "Agent", { status: "active", supervisorUserId });
  });

  let result: { agent: OfflineActivationAgent; supervisorUserId: string };
  try {
    result = await finishRedemption({ userId, supervisorUserId, churchId, codeId: row.id });
  } catch (error) {
    // Give the use back so a failed registration does not burn the code.
    await mutateProgram((current) => {
      const live = current.agentInviteCodes.find((code) => code.id === row.id);
      if (live) live.uses = live.uses.filter((use) => use.userId !== userId);
      const member = current.members[userId];
      if (member?.role === "Agent" && member.supervisorUserId === supervisorUserId && !existingMember) {
        delete current.members[userId];
      }
    }).catch(() => {});
    throw error;
  }
  const agent = result.agent;

  await appendOfflineActivationAudit({
    actorUserId: userId,
    actorRole: "Member",
    action: "agent.code_redeemed",
    targetType: "invite_code",
    targetId: row.id,
    details: { supervisorUserId, agentRegistrationId: agent.id },
  });
  await appendOfflineActivationAudit({
    actorUserId: userId,
    actorRole: "Member",
    action: "role.granted",
    targetType: "user",
    targetId: userId,
    details: { role: "Agent", supervisorUserId, via: "invite_code" },
  });

  return result;
}

async function finishRedemption(input: {
  userId: string;
  supervisorUserId: string;
  churchId: string;
  codeId: string;
}): Promise<{ agent: OfflineActivationAgent; supervisorUserId: string }> {
  const { userId, supervisorUserId, churchId } = input;
  const row = { id: input.codeId };
  const who = await displayName(userId);
  // Reuse an earlier (pending/declined) registration with this supervisor instead of duplicating it.
  const previous = await findSupervisorAgentByLinkedUser(supervisorUserId, userId, churchId);
  const agent = previous
    ? (await updateAgentRegistrationStatusByInvite({
        supervisorUserId,
        linkedUserId: userId,
        churchId,
        status: "accepted",
      }))!
    : await createSupervisorAgent({
        supervisorUserId,
        kristoId: who.kristoId || userId,
        churchId,
        fullName: who.name || who.kristoId || "Agent",
        status: "accepted",
        linkedUserId: userId,
      });
  await upsertPlatformRole(userId, "Agent", `Agent of ${supervisorUserId} • invite code ${row.id}`);

  return { agent, supervisorUserId };
}

/* =========================
   Church onboarding (Agent)
   ========================= */

function deriveStatus(row: ChurchOnboarding): OnboardingStatus {
  const confirmation = row.leaderConfirmation;
  if (confirmation?.status === "confirmed" && confirmation.respondedByUserId === row.leaderUserId) {
    return "confirmed";
  }
  if (confirmation?.status === "needs_help") return "needs_help";
  if (confirmation?.status === "rejected") return "rejected";
  if (confirmation?.status === "pending") return "awaiting_confirmation";
  if (!row.churchId || !row.registeredAt) return "invited";
  if (row.agentReport && !row.agentReport.trainingCompleted) return "training_pending";
  return "registered";
}

async function verifyRegisteredChurch(churchIdRaw: string, leaderUserId: string) {
  const churchId = normalizeMembershipChurchId(churchIdRaw);
  if (!churchId) return null;
  const church = await getChurchById(churchId);
  if (!church) throw new ProgramError(404, "Church ID not found");
  const isLeader = await isApproverForChurch(leaderUserId, churchId);
  if (!isLeader) {
    throw new ProgramError(400, "This Kristo ID is not a pastor or admin of that church");
  }
  return { churchId, churchName: String((church as any).name || "").trim() };
}

async function upsertChurchOnboardingUnlocked(input: {
  agentUserId: string;
  supervisorUserId: string;
  leaderKristoId: string;
  churchId?: string;
}): Promise<{ onboarding: ChurchOnboarding; created: boolean }> {
  const agentUserId = String(input.agentUserId || "").trim();
  const leader = await resolveUserByKristoId(input.leaderKristoId).catch((error) => {
    throw new ProgramError(400, String(error?.message || "Leader KRISTO ID not found"));
  });
  if (leader.userId === agentUserId) {
    throw new ProgramError(400, "An agent cannot be the leader they report on");
  }
  const registered = input.churchId
    ? await verifyRegisteredChurch(input.churchId, leader.userId)
    : null;

  if (useProgramPostgres()) {
    const saved = await pgCall<{ id: string; created: boolean }>("oact_save_onboarding",
      [agentUserId, input.supervisorUserId, leader.userId, leader.kristoId, registered?.churchId ?? null, newId("oactonb")],
      ["text", "text", "text", "text", "text", "text"]);
    return { onboarding: await pgOnboarding(saved.id), created: saved.created };
  }

  const outcome = await mutateProgram((store) => {
    const byChurch = registered
      ? store.onboardings.find((row) => row.churchId === registered.churchId)
      : undefined;
    const byLeader = store.onboardings.find(
      (row) => row.leaderUserId === leader.userId && (!row.churchId || row.churchId === registered?.churchId)
    );
    const existing = byChurch || byLeader;

    if (existing && existing.agentUserId !== agentUserId) {
      // Each church/leader is counted once, for the agent who supported it first.
      throw new ProgramError(409, "This church is already supported by another agent");
    }

    const now = nowIso();
    if (existing) {
      let changed = false;
      if (registered && !existing.churchId) {
        existing.churchId = registered.churchId;
        existing.registeredAt = now;
        changed = true;
      }
      if (changed) {
        existing.status = deriveStatus(existing);
        existing.updatedAt = now;
      }
      return { onboarding: { ...existing }, created: false, registeredNow: changed };
    }

    const row: ChurchOnboarding = {
      id: newId("oactonb"),
      agentUserId,
      supervisorUserId: input.supervisorUserId,
      leaderUserId: leader.userId,
      leaderKristoId: leader.kristoId,
      churchId: registered?.churchId,
      registeredAt: registered ? now : undefined,
      status: "invited",
      agentReport: null,
      leaderConfirmation: null,
      confirmationHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    row.status = deriveStatus(row);
    store.onboardings.push(row);
    return { onboarding: { ...row }, created: true, registeredNow: Boolean(registered) };
  });

  if (outcome.created) {
    await appendOfflineActivationAudit({
      actorUserId: agentUserId,
      actorRole: "Agent",
      action: "onboarding.created",
      targetType: "onboarding",
      targetId: outcome.onboarding.id,
      details: {
        leaderUserId: leader.userId,
        churchId: outcome.onboarding.churchId || null,
        supervisorUserId: input.supervisorUserId,
      },
    });
  }
  if (outcome.registeredNow) {
    await appendOfflineActivationAudit({
      actorUserId: agentUserId,
      actorRole: "Agent",
      action: "onboarding.church_registered",
      targetType: "onboarding",
      targetId: outcome.onboarding.id,
      details: { churchId: outcome.onboarding.churchId || null },
    });
  }

  return { onboarding: outcome.onboarding, created: outcome.created };
}

const FOLLOW_UP_VALUES = new Set<FollowUpStatus>(["none", "scheduled", "in_progress", "completed"]);

async function submitTrainingReportUnlocked(input: {
  agentUserId: string;
  onboardingId: string;
  churchId?: string;
  trainingTopics?: unknown;
  trainingNotes?: unknown;
  trainingCompleted?: unknown;
  followUpStatus?: unknown;
  followUpNote?: unknown;
}): Promise<{ onboarding: ChurchOnboarding; confirmationRequested: boolean; duplicate: boolean }> {
  const agentUserId = String(input.agentUserId || "").trim();
  const onboardingId = String(input.onboardingId || "").trim();
  const topics = (Array.isArray(input.trainingTopics) ? input.trainingTopics : [])
    .map((topic) => cleanText(topic, 80))
    .filter(Boolean)
    .slice(0, 20);
  const trainingNotes = cleanText(input.trainingNotes, 2000);
  const trainingCompleted = input.trainingCompleted === true;
  const followUpStatus = String(input.followUpStatus || "none") as FollowUpStatus;
  if (!FOLLOW_UP_VALUES.has(followUpStatus)) throw new ProgramError(400, "Invalid followUpStatus");
  if (trainingCompleted && topics.length === 0) {
    throw new ProgramError(400, "List at least one training topic");
  }

  const current = (await readProgram()).onboardings.find((row) => row.id === onboardingId);
  if (!current || current.agentUserId !== agentUserId) throw new ProgramError(404, "Onboarding not found");

  const registered = input.churchId && !current.churchId
    ? await verifyRegisteredChurch(input.churchId, current.leaderUserId)
    : current.churchId
      ? await verifyRegisteredChurch(current.churchId, current.leaderUserId)
      : null;
  if (!registered) {
    throw new ProgramError(400, "Register the church (Church ID) before submitting training");
  }

  if (useProgramPostgres()) {
    const report = {
      trainingTopics: topics,
      trainingNotes,
      trainingCompleted,
      followUpStatus,
      followUpNote: cleanText(input.followUpNote, 500),
    };
    const saved = await pgCall<{ duplicate: boolean; confirmationRequested: boolean }>("oact_submit_report",
      [agentUserId, onboardingId, current.churchId ? null : registered.churchId, report, newId("oactconf"),
        LEADER_CONFIRMATION_QUESTION, nowIso()],
      ["text", "text", "text", "jsonb", "text", "text", "text"]);
    return {
      onboarding: await pgOnboarding(onboardingId),
      confirmationRequested: saved.confirmationRequested,
      duplicate: saved.duplicate,
    };
  }

  const outcome = await mutateProgram((store) => {
    const row = store.onboardings.find((item) => item.id === onboardingId);
    if (!row || row.agentUserId !== agentUserId) throw new ProgramError(404, "Onboarding not found");
    if (row.leaderConfirmation?.status === "confirmed") {
      throw new ProgramError(409, "The leader already confirmed this training");
    }
    const clash = store.onboardings.find(
      (item) => item.id !== row.id && item.churchId === registered.churchId
    );
    if (clash) throw new ProgramError(409, "This church is already supported by another agent");

    const now = nowIso();
    let registeredNow = false;
    if (!row.churchId) {
      row.churchId = registered.churchId;
      row.registeredAt = now;
      registeredNow = true;
    }

    const previous = row.agentReport;
    const sameAsBefore =
      previous &&
      previous.trainingCompleted === trainingCompleted &&
      previous.trainingNotes === trainingNotes &&
      previous.followUpStatus === followUpStatus &&
      previous.followUpNote === cleanText(input.followUpNote, 500) &&
      JSON.stringify(previous.trainingTopics) === JSON.stringify(topics);
    const pending = row.leaderConfirmation?.status === "pending";

    if (sameAsBefore && (pending || !trainingCompleted)) {
      return { onboarding: { ...row }, confirmationRequested: false, duplicate: true, registeredNow };
    }

    row.agentReport = {
      trainingTopics: topics,
      trainingNotes,
      trainingCompleted,
      followUpStatus,
      followUpNote: cleanText(input.followUpNote, 500),
      submittedAt: now,
      version: (previous?.version || 0) + 1,
    };

    let confirmationRequested = false;
    if (trainingCompleted) {
      if (pending && row.leaderConfirmation) {
        // Keep the single open request; it now refers to the latest report.
        row.leaderConfirmation.reportVersion = row.agentReport.version;
      } else {
        if (row.leaderConfirmation) row.confirmationHistory.push(row.leaderConfirmation);
        row.leaderConfirmation = {
          requestId: newId("oactconf"),
          status: "pending",
          question: LEADER_CONFIRMATION_QUESTION,
          requestedAt: now,
          reportVersion: row.agentReport.version,
        };
        confirmationRequested = true;
      }
    }

    row.status = deriveStatus(row);
    row.updatedAt = now;
    return { onboarding: { ...row }, confirmationRequested, duplicate: false, registeredNow };
  });

  if (outcome.registeredNow) {
    await appendOfflineActivationAudit({
      actorUserId: agentUserId,
      actorRole: "Agent",
      action: "onboarding.church_registered",
      targetType: "onboarding",
      targetId: onboardingId,
      details: { churchId: outcome.onboarding.churchId || null },
    });
  }
  if (!outcome.duplicate) {
    await appendOfflineActivationAudit({
      actorUserId: agentUserId,
      actorRole: "Agent",
      action: "onboarding.report_submitted",
      targetType: "onboarding",
      targetId: onboardingId,
      details: {
        version: outcome.onboarding.agentReport?.version || 0,
        trainingCompleted,
        followUpStatus,
        topicCount: topics.length,
      },
    });
  }
  if (outcome.confirmationRequested && outcome.onboarding.leaderConfirmation) {
    await appendOfflineActivationAudit({
      actorUserId: agentUserId,
      actorRole: "Agent",
      action: "confirmation.requested",
      targetType: "confirmation",
      targetId: outcome.onboarding.leaderConfirmation.requestId,
      details: { onboardingId, leaderUserId: outcome.onboarding.leaderUserId },
    });
  }

  return {
    onboarding: outcome.onboarding,
    confirmationRequested: outcome.confirmationRequested,
    duplicate: outcome.duplicate,
  };
}

/* =========================
   Leader confirmation
   ========================= */

export type LeaderConfirmationView = {
  requestId: string;
  onboardingId: string;
  question: string;
  requestedAt: string;
  churchId: string;
  agent: { name: string; kristoId: string };
  report: Pick<AgentTrainingReport, "trainingTopics" | "trainingNotes" | "followUpStatus" | "followUpNote" | "submittedAt">;
};

export async function listLeaderConfirmations(leaderUserId: string): Promise<LeaderConfirmationView[]> {
  const store = await readProgram();
  const rows = store.onboardings.filter(
    (row) => row.leaderUserId === leaderUserId && row.leaderConfirmation?.status === "pending"
  );
  return Promise.all(
    rows.map(async (row) => {
      const agent = await displayName(row.agentUserId);
      const report = row.agentReport!;
      return {
        requestId: row.leaderConfirmation!.requestId,
        onboardingId: row.id,
        question: row.leaderConfirmation!.question,
        requestedAt: row.leaderConfirmation!.requestedAt,
        churchId: row.churchId || "",
        agent,
        report: {
          trainingTopics: report.trainingTopics,
          trainingNotes: report.trainingNotes,
          followUpStatus: report.followUpStatus,
          followUpNote: report.followUpNote,
          submittedAt: report.submittedAt,
        },
      };
    })
  );
}

const RESPONSE_MAP: Record<string, LeaderConfirmationResponse> = {
  confirm: "confirmed",
  confirmed: "confirmed",
  reject: "rejected",
  rejected: "rejected",
  needs_help: "needs_help",
};

async function respondLeaderConfirmationUnlocked(input: {
  leaderUserId: string;
  requestId: string;
  response: string;
  note?: string;
}): Promise<{ onboarding: ChurchOnboarding; duplicate: boolean }> {
  const leaderUserId = String(input.leaderUserId || "").trim();
  const requestId = String(input.requestId || "").trim();
  const response = RESPONSE_MAP[String(input.response || "").trim()];
  if (!response) throw new ProgramError(400, "response must be confirm, reject or needs_help");
  const note = cleanText(input.note, 500);
  if (useProgramPostgres()) {
    const saved = await pgCall<{ duplicate: boolean; onboardingId: string }>("oact_respond_confirmation",
      [leaderUserId, requestId, response, note], ["text", "text", "text", "text"]);
    return { onboarding: await pgOnboarding(saved.onboardingId), duplicate: saved.duplicate };
  }

  const outcome = await mutateProgram((store) => {
    const row = store.onboardings.find((item) => item.leaderConfirmation?.requestId === requestId);
    // Only the named leader may answer; anyone else sees "not found".
    if (!row || row.leaderUserId !== leaderUserId || !row.leaderConfirmation) {
      throw new ProgramError(404, "Confirmation request not found");
    }
    const confirmation = row.leaderConfirmation;
    if (confirmation.status !== "pending") {
      if (confirmation.status === response) {
        return { onboarding: { ...row }, duplicate: true };
      }
      throw new ProgramError(409, `Already answered: ${confirmation.status}`);
    }
    const now = nowIso();
    confirmation.status = response;
    confirmation.respondedAt = now;
    confirmation.respondedByUserId = leaderUserId;
    if (note) confirmation.note = note;
    row.status = deriveStatus(row);
    row.updatedAt = now;
    return { onboarding: { ...row }, duplicate: false };
  });

  if (!outcome.duplicate) {
    await appendOfflineActivationAudit({
      actorUserId: leaderUserId,
      actorRole: "Church_Leader",
      action: "confirmation.responded",
      targetType: "confirmation",
      targetId: requestId,
      details: { onboardingId: outcome.onboarding.id, response, hasNote: Boolean(note) },
    });
  }
  return outcome;
}

/* =========================
   Read models (Admin / Supervisor / Agent)
   ========================= */

export type DateRange = { from?: string; to?: string };

function inRange(iso: string | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  if (range.from && t < Date.parse(range.from)) return false;
  if (range.to) {
    const end = Date.parse(range.to.length <= 10 ? `${range.to}T23:59:59.999Z` : range.to);
    if (t > end) return false;
  }
  return true;
}

function emptyStatusCounts(): Record<OnboardingStatus, number> {
  return {
    invited: 0,
    registered: 0,
    training_pending: 0,
    awaiting_confirmation: 0,
    confirmed: 0,
    needs_help: 0,
    rejected: 0,
  };
}

function summarizeOnboardings(rows: ChurchOnboarding[], range: DateRange = {}) {
  const byStatus = emptyStatusCounts();
  const filtered = rows.filter((row) =>
    range.from || range.to ? inRange(row.createdAt, range) || inRange(row.updatedAt, range) : true
  );
  for (const row of filtered) byStatus[deriveStatus(row)] += 1;
  const confirmedInRange = rows.filter(
    (row) =>
      deriveStatus(row) === "confirmed" &&
      (range.from || range.to ? inRange(row.leaderConfirmation?.respondedAt, range) : true)
  ).length;
  return {
    churches: new Set(filtered.map((row) => row.churchId || `leader:${row.leaderUserId}`)).size,
    byStatus,
    confirmedInRange,
  };
}

function dailySeries(rows: ChurchOnboarding[], range: DateRange) {
  const days = new Map<string, { date: string; invited: number; reports: number; confirmed: number }>();
  const bump = (iso: string | undefined, key: "invited" | "reports" | "confirmed") => {
    if (!iso || ((range.from || range.to) && !inRange(iso, range))) return;
    const date = iso.slice(0, 10);
    const entry = days.get(date) || { date, invited: 0, reports: 0, confirmed: 0 };
    entry[key] += 1;
    days.set(date, entry);
  };
  for (const row of rows) {
    bump(row.createdAt, "invited");
    bump(row.agentReport?.submittedAt, "reports");
    if (deriveStatus(row) === "confirmed") bump(row.leaderConfirmation?.respondedAt, "confirmed");
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function publicOnboarding(row: ChurchOnboarding) {
  return {
    id: row.id,
    churchId: row.churchId || null,
    leaderKristoId: row.leaderKristoId,
    status: deriveStatus(row),
    registeredAt: row.registeredAt || null,
    agentReport: row.agentReport,
    leaderConfirmation: row.leaderConfirmation
      ? {
          status: row.leaderConfirmation.status,
          requestedAt: row.leaderConfirmation.requestedAt,
          respondedAt: row.leaderConfirmation.respondedAt || null,
          note: row.leaderConfirmation.note || null,
        }
      : null,
    confirmationRounds: row.confirmationHistory.length + (row.leaderConfirmation ? 1 : 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function agentSummary(
  agent: OfflineActivationAgent,
  store: ProgramStore,
  range: DateRange
) {
  const userId = String(agent.linkedUserId || "");
  const rows = store.onboardings.filter((row) => row.agentUserId === userId);
  const member = store.members[userId];
  const role = userId ? await getPlatformRole(userId) : null;
  return {
    userId,
    registrationId: agent.id,
    name: agent.fullName,
    kristoId: agent.kristoId,
    churchId: agent.churchId,
    registrationStatus: agent.status,
    accessStatus: member?.status || (role === "Agent" ? "active" : agent.status === "pending" ? "invited" : "inactive"),
    hasAgentRole: role === "Agent",
    joinedAt: agent.createdAt,
    onboardings: summarizeOnboardings(rows, range),
    lastActivityAt: rows.map((row) => row.updatedAt).sort().pop() || null,
  };
}

export async function supervisorTeamView(supervisorUserId: string, range: DateRange = {}) {
  const store = await readProgram();
  const agents = await listSupervisorAgents(supervisorUserId);
  const rows = store.onboardings.filter((row) => row.supervisorUserId === supervisorUserId);
  const member = store.members[supervisorUserId];
  const used = await countSupervisorAgentSlots(supervisorUserId);
  return {
    supervisorUserId,
    accessStatus: member?.status || "active",
    agentLimit: agentLimitFor(member, used),
    agentLimitIsDefault: !(Number.isFinite(Number(member?.agentLimit)) && Number(member?.agentLimit) >= 0),
    agentSlotsUsed: used,
    agents: await Promise.all(agents.map((agent) => agentSummary(agent, store, range))),
    onboardings: summarizeOnboardings(rows, range),
    series: dailySeries(rows, range),
    inviteCodes: store.agentInviteCodes
      .filter((code) => code.supervisorUserId === supervisorUserId)
      .map(publicCode)
      .reverse(),
  };
}

export async function supervisorAgentDetail(input: {
  supervisorUserId: string | null;
  agentUserId: string;
}) {
  const agentUserId = String(input.agentUserId || "").trim();
  const registrations = await listAgentsByLinkedUserId(agentUserId);
  const own = input.supervisorUserId
    ? registrations.filter((row) => row.supervisorUserId === input.supervisorUserId)
    : registrations;
  // Agents of another supervisor are reported as missing, not forbidden.
  if (!own.length) throw new ProgramError(404, "Agent not found");
  const store = await readProgram();
  const rows = store.onboardings.filter(
    (row) =>
      row.agentUserId === agentUserId &&
      (!input.supervisorUserId || row.supervisorUserId === input.supervisorUserId)
  );
  return {
    agent: await agentSummary(own[0], store, {}),
    churches: rows.map(publicOnboarding),
  };
}

export async function agentWorkView(agentUserId: string, supervisorUserId: string) {
  const store = await readProgram();
  const rows = store.onboardings.filter((row) => row.agentUserId === agentUserId);
  const supervisor = await displayName(supervisorUserId);
  return {
    agentUserId,
    supervisor: { userId: supervisorUserId, name: supervisor.name, kristoId: supervisor.kristoId },
    summary: summarizeOnboardings(rows),
    churches: rows.map(publicOnboarding),
  };
}

export async function adminOverview(range: DateRange = {}) {
  const store = await readProgram();
  const supervisorIds = new Set<string>(
    (await listPlatformRoleUsers("Supervisor")).map((row) => row.userId)
  );
  for (const member of Object.values(store.members)) {
    if (member.role === "Supervisor") supervisorIds.add(member.userId);
  }

  const supervisors = await Promise.all(
    [...supervisorIds].map(async (userId) => {
      const team = await supervisorTeamView(userId, range);
      const who = await displayName(userId);
      const role = await getPlatformRole(userId);
      return {
        userId,
        name: who.name,
        kristoId: who.kristoId,
        hasSupervisorRole: role === "Supervisor",
        accessStatus: team.accessStatus,
        agentLimit: team.agentLimit,
        agentSlotsUsed: team.agentSlotsUsed,
        agents: team.agents,
        onboardings: team.onboardings,
      };
    })
  );

  return {
    generatedAt: nowIso(),
    range,
    totals: {
      supervisors: supervisors.length,
      activeSupervisors: supervisors.filter((s) => s.hasSupervisorRole && s.accessStatus === "active").length,
      agents: supervisors.reduce((sum, s) => sum + s.agents.length, 0),
      agentsWithRole: supervisors.reduce((sum, s) => sum + s.agents.filter((a) => a.hasAgentRole).length, 0),
      onboardings: summarizeOnboardings(store.onboardings, range),
    },
    series: dailySeries(store.onboardings, range),
    supervisors,
  };
}

export async function adminAuditView(filter: { limit?: number; userId?: string } = {}) {
  if (!filter.userId) return listOfflineActivationAudit({ limit: filter.limit });
  return listOfflineActivationAudit({
    limit: filter.limit,
    targetIds: [filter.userId],
    actorUserIds: [filter.userId],
  });
}

export type { OfflineActivationAuditEvent };

/* =========================
   Uvumbuzi Lab admin sign-in codes
   ========================= */

export async function createAdminLoginCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  const code = `${randomCode(4)}-${randomCode(4)}`;
  const expiresAt = new Date(Date.now() + ADMIN_LOGIN_CODE_TTL_SECONDS * 1000).toISOString();
  if (useProgramPostgres()) {
    await pgCall("oact_create_admin_login_code", [userId, hashSecret(normalizeCodeInput(code)), expiresAt],
      ["text", "text", "timestamptz"]);
    return { code, expiresAt };
  }
  await mutateProgram((store) => {
    const now = Date.now();
    store.adminLoginCodes = store.adminLoginCodes.filter(
      (row) => !row.usedAt && Date.parse(row.expiresAt) > now && row.userId !== userId
    );
    store.adminLoginCodes.push({ codeHash: hashSecret(normalizeCodeInput(code)), userId, expiresAt });
  });
  await appendOfflineActivationAudit({
    actorUserId: userId,
    actorRole: "System_Admin",
    action: "admin.login_code_created",
    targetType: "admin_session",
    targetId: userId,
    details: { expiresAt },
  });
  return { code, expiresAt };
}

/** Single use: a second exchange of the same code fails. */
export async function consumeAdminLoginCode(code: string): Promise<string> {
  const codeHash = hashSecret(normalizeCodeInput(code));
  if (useProgramPostgres()) {
    const userId = await dbConsumeAdminLoginCode(codeHash);
    if (!userId) throw new ProgramError(401, "Invalid or expired sign-in code");
    return userId;
  }
  return mutateProgram((store) => {
    const row = store.adminLoginCodes.find((item) => item.codeHash === codeHash);
    if (!row || row.usedAt || Date.parse(row.expiresAt) <= Date.now()) {
      throw new ProgramError(401, "Invalid or expired sign-in code");
    }
    row.usedAt = nowIso();
    return row.userId;
  });
}

/* =========================
   Postgres-only multi-record operations
   ========================= */

function newAgentRegistrationId() {
  return `oactagent_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

async function pgRedeem(userId: string, codeHash: string): Promise<{ agent: OfflineActivationAgent; supervisorUserId: string }> {
  const active = await getActiveMembership(userId);
  const churchId = normalizeMembershipChurchId(active?.churchId);
  if (!active || !churchId) {
    throw new ProgramError(400, "Join your church in Kristo before becoming an agent");
  }
  const who = await displayName(userId);
  const now = nowIso();
  const record = {
    id: newAgentRegistrationId(),
    supervisorUserId: "",
    kristoId: who.kristoId || userId,
    churchId,
    fullName: who.name || who.kristoId || "Agent",
    phone: "",
    status: "accepted",
    linkedUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
  // The supervisor is only known inside the transaction (from the locked code row).
  const result = await pgCall<{ supervisorUserId: string; agentRegistrationId: string }>("oact_redeem_invite_code",
    [userId, codeHash, churchId, record, DEFAULT_SUPERVISOR_AGENT_LIMIT, now],
    ["text", "text", "text", "jsonb", "int", "text"]);
  const agents = await listAgentsByLinkedUserId(userId);
  let agent = agents.find((row) => row.id === result.agentRegistrationId);
  if (agent && !agent.supervisorUserId) agent = { ...agent, supervisorUserId: result.supervisorUserId };
  return { agent: agent!, supervisorUserId: result.supervisorUserId };
}

async function pgAdminInviteSupervisor(input: {
  actorUserId: string;
  kristoId: string;
  churchId: string;
  agentLimit?: number;
}) {
  const churchId = normalizeMembershipChurchId(input.churchId);
  if (!churchId) throw new ProgramError(400, "Church ID is required");
  const limit =
    input.agentLimit === undefined || input.agentLimit === null ? null : Math.floor(Number(input.agentLimit));
  if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > MAX_SUPERVISOR_AGENT_LIMIT)) {
    throw new ProgramError(400, `agentLimit must be 0–${MAX_SUPERVISOR_AGENT_LIMIT}`);
  }
  const resolved = await resolveUserByKristoId(input.kristoId).catch((error) => {
    throw new ProgramError(400, String(error?.message || "KRISTO ID not found"));
  });
  if (!(await getChurchById(churchId))) throw new ProgramError(404, "Church ID not found");
  const active = await getActiveMembership(resolved.userId);
  if (!active || normalizeMembershipChurchId(active.churchId) !== churchId) {
    throw new ProgramError(400, "User is not an Active member of this church");
  }
  const user = { userId: resolved.userId, kristoId: resolved.kristoId, churchId, fullName: resolved.fullName };
  const existingRole = await getPlatformRole(resolved.userId);
  if (existingRole === "System_Admin") throw new ProgramError(400, "User is already System_Admin");
  if (existingRole === "Agent") throw new ProgramError(400, "User is already an Agent");
  if (existingRole === "Supervisor") {
    if (limit !== null) {
      await pgCall("oact_set_supervisor_limit", [input.actorUserId, resolved.userId, limit, DEFAULT_SUPERVISOR_AGENT_LIMIT],
        ["text", "text", "int", "int"]);
    }
    return { outcome: "alreadySupervisor" as const, user, invitation: undefined };
  }
  const result = await pgCall<{ outcome: "invited" | "alreadyPending"; invitationId: string }>("oact_invite_supervisor",
    [input.actorUserId, resolved.userId, resolved.kristoId, churchId,
      `oactinv_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, limit],
    ["text", "text", "text", "text", "text", "int"]);
  return { outcome: result.outcome, user, invitation: (await getInvitationById(result.invitationId)) || undefined };
}

/* =========================
   Serialised entry points (see withOfflineActivationLock)
   ========================= */

export const adminSetSupervisorLimit = (...args: Parameters<typeof adminSetSupervisorLimitUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => adminSetSupervisorLimitUnlocked(...args));
export const adminInviteSupervisor = (...args: Parameters<typeof adminInviteSupervisorUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => adminInviteSupervisorUnlocked(...args));
export const adminSetMemberStatus = (...args: Parameters<typeof adminSetMemberStatusUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => adminSetMemberStatusUnlocked(...args));
export const createAgentInviteCode = (...args: Parameters<typeof createAgentInviteCodeUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => createAgentInviteCodeUnlocked(...args));
export const revokeAgentInviteCode = (...args: Parameters<typeof revokeAgentInviteCodeUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => revokeAgentInviteCodeUnlocked(...args));
export const redeemAgentInviteCode = (...args: Parameters<typeof redeemAgentInviteCodeUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => redeemAgentInviteCodeUnlocked(...args));
export const upsertChurchOnboarding = (...args: Parameters<typeof upsertChurchOnboardingUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => upsertChurchOnboardingUnlocked(...args));
export const submitTrainingReport = (...args: Parameters<typeof submitTrainingReportUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => submitTrainingReportUnlocked(...args));
export const respondLeaderConfirmation = (...args: Parameters<typeof respondLeaderConfirmationUnlocked>) =>
  withOfflineActivationLock(PROGRAM_LOCK, () => respondLeaderConfirmationUnlocked(...args));
