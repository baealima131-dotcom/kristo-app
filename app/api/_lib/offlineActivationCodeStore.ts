import { listAgentsByLinkedUserId, isAcceptedAgentStatus } from "@/app/api/_lib/offlineActivationAgentStore";
import {
  getOfflineActivationStoreDebugInfo,
  OFFLINE_ACTIVATION_CODES_STORE_KEY,
  readOfflineActivationJsonFile,
  updateOfflineActivationJsonFile,
} from "@/app/api/_lib/store/offlineActivationDb";
import { getChurchById } from "@/app/api/_lib/churches";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";
import { normalizeMembershipChurchId } from "@/app/api/_lib/memberships";
import { getPlatformRole, listPlatformRoleUsers, deletePlatformRole } from "@/app/api/_lib/platformRoles";
import { listPendingSupervisorInvitations, cancelSupervisorInvitation } from "@/app/api/_lib/offlineActivationInvitations";

export type ActivationCodeStatus =
  | "available"
  | "assigned_to_supervisor"
  | "assigned_to_agent"
  | "disabled"
  | "redeemed";

export type ActivationBatchStatus = "active" | "disabled";

export type ActivationCode = {
  id: string;
  code: string;
  batchId: string;
  countryCode: string;
  durationMonths: number;
  status: ActivationCodeStatus;
  createdAt: string;
  createdByUserId: string;
  assignedSupervisorUserId?: string | null;
  assignedSupervisorAt?: string | null;
  assignedBySystemAdminUserId?: string | null;
  assignedAgentUserId?: string | null;
  assignedAgentAt?: string | null;
  assignedBySupervisorUserId?: string | null;
  deliveredToChurchId?: string | null;
  redeemedAt?: string | null;
  redeemedByChurchId?: string | null;
  redeemedByUserId?: string | null;
};

export type ActivationCodeBatch = {
  batchId: string;
  countryCode: string;
  durationMonths: number;
  quantity: number;
  createdByUserId: string;
  createdAt: string;
  status: ActivationBatchStatus;
  codes: ActivationCode[];
};

export type OfflineActivationCodeStore = {
  batches: ActivationCodeBatch[];
};

export type ActivationDashboardStats = {
  totalCodes: number;
  availableUnassigned: number;
  assignedToSupervisors: number;
  assignedToAgents: number;
  redeemed: number;
  disabled: number;
  supervisorCount: number;
  agentCount: number;
};

export type SupervisorCodeStats = {
  assignedCodes: number;
  redeemedCodes: number;
  remainingCodes: number;
};

export type SupervisorSummary = {
  userId: string;
  kristoId?: string;
  churchId?: string;
  fullName?: string;
  avatarUrl?: string;
  platformRole?: "Supervisor";
  invitationStatus: "pending" | "accepted";
  invitationId?: string;
  assignedCodes: number;
  redeemedCodes: number;
  remainingCodes: number;
  updatedAt?: string;
  note?: string;
};

const STORE_FILE = OFFLINE_ACTIVATION_CODES_STORE_KEY;

export const ACTIVATION_COUNTRY_CODES = ["BDI", "CD", "TZ", "US"] as const;
export type ActivationCountryCode = (typeof ACTIVATION_COUNTRY_CODES)[number];

export const ACTIVATION_DURATION_MONTHS = [1, 3, 6, 12] as const;
export type ActivationDurationMonths = (typeof ACTIVATION_DURATION_MONTHS)[number];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_BATCH_QUANTITY = 200;
const MAX_ASSIGN_QUANTITY = 500;

function emptyAssignmentFields(): Pick<
  ActivationCode,
  | "assignedSupervisorUserId"
  | "assignedSupervisorAt"
  | "assignedBySystemAdminUserId"
  | "assignedAgentUserId"
  | "assignedAgentAt"
  | "assignedBySupervisorUserId"
  | "deliveredToChurchId"
  | "redeemedAt"
  | "redeemedByChurchId"
  | "redeemedByUserId"
> {
  return {
    assignedSupervisorUserId: null,
    assignedSupervisorAt: null,
    assignedBySystemAdminUserId: null,
    assignedAgentUserId: null,
    assignedAgentAt: null,
    assignedBySupervisorUserId: null,
    deliveredToChurchId: null,
    redeemedAt: null,
    redeemedByChurchId: null,
    redeemedByUserId: null,
  };
}

export function normalizeActivationCode(raw: Partial<ActivationCode>): ActivationCode {
  const statusRaw = String(raw.status || "available").trim();
  let status: ActivationCodeStatus = "available";
  if (
    statusRaw === "assigned_to_supervisor" ||
    statusRaw === "assigned_to_agent" ||
    statusRaw === "disabled" ||
    statusRaw === "redeemed" ||
    statusRaw === "available"
  ) {
    status = statusRaw;
  } else if (raw.assignedSupervisorUserId) {
    status = "assigned_to_supervisor";
  }

  const assignedSupervisorUserId = raw.assignedSupervisorUserId ?? null;
  const assignedAgentUserId = raw.assignedAgentUserId ?? null;

  if (status !== "redeemed" && status !== "disabled") {
    if (String(assignedAgentUserId || "").trim()) {
      status = "assigned_to_agent";
    } else if (String(assignedSupervisorUserId || "").trim()) {
      status = "assigned_to_supervisor";
    } else {
      status = "available";
    }
  }

  return {
    id: String(raw.id || ""),
    code: String(raw.code || ""),
    batchId: String(raw.batchId || ""),
    countryCode: String(raw.countryCode || ""),
    durationMonths: Number(raw.durationMonths || 0),
    status,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    createdByUserId: String(raw.createdByUserId || ""),
    ...emptyAssignmentFields(),
    assignedSupervisorUserId,
    assignedSupervisorAt: raw.assignedSupervisorAt ?? null,
    assignedBySystemAdminUserId: raw.assignedBySystemAdminUserId ?? null,
    assignedAgentUserId,
    assignedAgentAt: raw.assignedAgentAt ?? null,
    assignedBySupervisorUserId: raw.assignedBySupervisorUserId ?? null,
    deliveredToChurchId: raw.deliveredToChurchId ?? null,
    redeemedAt: raw.redeemedAt ?? null,
    redeemedByChurchId: raw.redeemedByChurchId ?? null,
    redeemedByUserId: raw.redeemedByUserId ?? null,
  };
}

/** Assignable pool: generated codes not yet assigned, redeemed, or disabled. */
export function isAssignableActivationCode(code: ActivationCode): boolean {
  if (code.status === "redeemed" || code.status === "disabled") return false;
  if (String(code.assignedSupervisorUserId || "").trim()) return false;
  if (String(code.assignedAgentUserId || "").trim()) return false;
  return true;
}

export function isUnassignedAvailableCode(code: ActivationCode): boolean {
  return isAssignableActivationCode(code);
}

export function countAssignableActivationCodes(codes: ActivationCode[]): number {
  return codes.filter(isAssignableActivationCode).length;
}

export function computeSupervisorCodeStats(
  codes: ActivationCode[],
  supervisorUserId: string
): SupervisorCodeStats {
  const uid = String(supervisorUserId || "").trim();
  const mine = codes.filter((code) => String(code.assignedSupervisorUserId || "").trim() === uid);
  const redeemedCodes = mine.filter((code) => code.status === "redeemed").length;
  const remainingCodes = mine.filter(
    (code) => code.status === "assigned_to_supervisor" || code.status === "assigned_to_agent"
  ).length;

  return {
    assignedCodes: mine.length,
    redeemedCodes,
    remainingCodes,
  };
}

export function computeDashboardStats(
  codes: ActivationCode[],
  supervisorCount: number,
  agentCount: number
): ActivationDashboardStats {
  return {
    totalCodes: codes.length,
    availableUnassigned: codes.filter(isUnassignedAvailableCode).length,
    assignedToSupervisors: codes.filter(
      (code) => Boolean(code.assignedSupervisorUserId) && code.status !== "redeemed"
    ).length,
    assignedToAgents: codes.filter(
      (code) => Boolean(code.assignedAgentUserId) && code.status !== "redeemed"
    ).length,
    redeemed: codes.filter((code) => code.status === "redeemed").length,
    disabled: codes.filter((code) => code.status === "disabled").length,
    supervisorCount,
    agentCount,
  };
}

function randomSegment(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function newBatchId(): string {
  return `batch_${Date.now().toString(36)}_${randomSegment(6)}`;
}

function newCodeId(): string {
  return `actcode_${Date.now().toString(36)}_${randomSegment(8)}`;
}

export function formatActivationCode(countryCode: string, durationMonths: number): string {
  return `KR-${countryCode}-M${durationMonths}-${randomSegment()}-${randomSegment()}`;
}

export function isAllowedCountryCode(value: unknown): value is ActivationCountryCode {
  return ACTIVATION_COUNTRY_CODES.includes(String(value || "").trim().toUpperCase() as ActivationCountryCode);
}

export function isAllowedDurationMonths(value: unknown): value is ActivationDurationMonths {
  const n = Number(value);
  return ACTIVATION_DURATION_MONTHS.includes(n as ActivationDurationMonths);
}

async function readStore(): Promise<OfflineActivationCodeStore> {
  const rows = await readOfflineActivationJsonFile<OfflineActivationCodeStore>(STORE_FILE, { batches: [] });
  const batches = Array.isArray(rows?.batches) ? rows.batches : [];
  return {
    batches: batches.map((batch) => ({
      ...batch,
      codes: Array.isArray(batch.codes) ? batch.codes.map((code) => normalizeActivationCode(code)) : [],
    })),
  };
}

/** Used by activation API routes for store diagnostics. */
export async function readActivationCodeStoreForDebug(): Promise<OfflineActivationCodeStore> {
  return readStore();
}

function logActivationCodeStoreSnapshot(
  label: string,
  store: OfflineActivationCodeStore,
  extra?: Record<string, unknown>
) {
  const codes = flattenCodes(store);
  const assignableCount = countAssignableActivationCodes(codes);
  const availableStatusCount = codes.filter((code) => code.status === "available").length;

  console.log(`[KRISTO] activation store ${label}`, {
    ...getOfflineActivationStoreDebugInfo(STORE_FILE),
    batchCount: store.batches.length,
    totalCodeCount: codes.length,
    assignableCount,
    availableCount: availableStatusCount,
    availableUnassigned: assignableCount,
    ...extra,
  });
}

function flattenCodes(store: OfflineActivationCodeStore): ActivationCode[] {
  return store.batches.flatMap((batch) => batch.codes || []);
}

function collectExistingCodes(store: OfflineActivationCodeStore): Set<string> {
  const seen = new Set<string>();
  for (const batch of store.batches) {
    for (const code of batch.codes || []) {
      const token = String(code?.code || "").trim().toUpperCase();
      if (token) seen.add(token);
    }
  }
  return seen;
}

function generateUniqueCodes(
  existing: Set<string>,
  countryCode: ActivationCountryCode,
  durationMonths: ActivationDurationMonths,
  quantity: number
): string[] {
  const out: string[] = [];
  const local = new Set(existing);

  while (out.length < quantity) {
    const candidate = formatActivationCode(countryCode, durationMonths);
    const key = candidate.toUpperCase();
    if (local.has(key)) continue;
    local.add(key);
    out.push(candidate);
  }

  return out;
}

function parseSupervisorChurchIdFromNote(note?: string): string | undefined {
  const match = String(note || "").match(/Supervisor for ([^\s•]+)/i);
  return match?.[1] ? normalizeMembershipChurchId(match[1]) : undefined;
}

async function resolveSupervisorDisplay(userId: string, note?: string) {
  const uid = String(userId || "").trim();
  const profile = await getProfile(uid).catch(() => null);
  return {
    kristoId: String(profile?.userCode || "").trim().toUpperCase() || undefined,
    churchId: parseSupervisorChurchIdFromNote(note),
    fullName: String(profile?.fullName || "").trim() || undefined,
    avatarUrl: String(profile?.avatarUrl || "").trim() || undefined,
  };
}

export type GenerateActivationBatchInput = {
  countryCode: ActivationCountryCode;
  durationMonths: ActivationDurationMonths;
  quantity: number;
  createdByUserId: string;
};

export type GenerateActivationBatchResult = {
  batch: ActivationCodeBatch;
  codes: ActivationCode[];
};

export async function generateActivationCodeBatch(
  input: GenerateActivationBatchInput
): Promise<GenerateActivationBatchResult> {
  const countryCode = String(input.countryCode || "").trim().toUpperCase() as ActivationCountryCode;
  const durationMonths = Number(input.durationMonths) as ActivationDurationMonths;
  const quantity = Math.floor(Number(input.quantity));
  const createdByUserId = String(input.createdByUserId || "").trim();

  if (!isAllowedCountryCode(countryCode)) {
    throw new Error("Invalid countryCode");
  }
  if (!isAllowedDurationMonths(durationMonths)) {
    throw new Error("Invalid durationMonths");
  }
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BATCH_QUANTITY) {
    throw new Error(`Quantity must be between 1 and ${MAX_BATCH_QUANTITY}`);
  }
  if (!createdByUserId) {
    throw new Error("createdByUserId required");
  }

  const createdAt = new Date().toISOString();
  const batchId = newBatchId();

  let createdBatch: ActivationCodeBatch | null = null;

  await updateOfflineActivationJsonFile<OfflineActivationCodeStore>(
    STORE_FILE,
    (current) => {
      const store: OfflineActivationCodeStore = {
        batches: Array.isArray(current?.batches) ? current.batches : [],
      };
      const existing = collectExistingCodes(store);
      const codeStrings = generateUniqueCodes(existing, countryCode, durationMonths, quantity);

      const codes: ActivationCode[] = codeStrings.map((code) =>
        normalizeActivationCode({
          id: newCodeId(),
          code,
          batchId,
          countryCode,
          durationMonths,
          status: "available",
          createdAt,
          createdByUserId,
          ...emptyAssignmentFields(),
        })
      );

      const batch: ActivationCodeBatch = {
        batchId,
        countryCode,
        durationMonths,
        quantity,
        createdByUserId,
        createdAt,
        status: "active",
        codes,
      };

      createdBatch = batch;
      return {
        batches: [batch, ...store.batches],
      };
    },
    { batches: [] }
  );

  if (!createdBatch) {
    throw new Error("Failed to create batch");
  }

  const verified = await readStore();
  logActivationCodeStoreSnapshot("after-generate", verified, {
    generatedBatchId: createdBatch.batchId,
    generatedCount: createdBatch.codes.length,
    firstGeneratedCodeStatus: createdBatch.codes[0]?.status || null,
    firstGeneratedCode: createdBatch.codes[0]?.code || null,
  });

  return {
    batch: createdBatch,
    codes: createdBatch.codes,
  };
}

export type ActivationCodesListResult = {
  batches: ActivationCodeBatch[];
  codes: ActivationCode[];
  totals: {
    batches: number;
    codes: number;
    available: number;
    availableUnassigned: number;
    assignedToSupervisors: number;
    disabled: number;
    redeemed: number;
  };
};

export async function listActivationCodes(limit = 200): Promise<ActivationCodesListResult> {
  const store = await readStore();
  logActivationCodeStoreSnapshot("codes-list", store, { limit });
  const batches = [...store.batches].sort(
    (a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))
  );

  const allCodes = flattenCodes(store);
  const codes = [...allCodes]
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(limit, 1000)));

  const assignableCount = countAssignableActivationCodes(allCodes);
  const totals = {
    batches: batches.length,
    codes: allCodes.length,
    available: assignableCount,
    availableUnassigned: assignableCount,
    assignedToSupervisors: allCodes.filter(
      (c) => Boolean(c.assignedSupervisorUserId) && c.status !== "redeemed"
    ).length,
    disabled: allCodes.filter((c) => c.status === "disabled").length,
    redeemed: allCodes.filter((c) => c.status === "redeemed").length,
  };

  return { batches, codes, totals };
}

export async function getActivationDashboard(): Promise<{
  stats: ActivationDashboardStats;
}> {
  const store = await readStore();
  const codes = flattenCodes(store);
  logActivationCodeStoreSnapshot("dashboard-load", store);
  const supervisors = await listPlatformRoleUsers("Supervisor");
  const agents = await listPlatformRoleUsers("Agent");

  return {
    stats: computeDashboardStats(codes, supervisors.length, agents.length),
  };
}

export async function listSupervisorSummaries(): Promise<{
  supervisors: SupervisorSummary[];
  availableUnassigned: number;
}> {
  const store = await readStore();
  const codes = flattenCodes(store);
  const availableUnassigned = countAssignableActivationCodes(codes);
  logActivationCodeStoreSnapshot("supervisors-load", store, { availableUnassigned });
  const supervisors = await listPlatformRoleUsers("Supervisor");

  const rows: SupervisorSummary[] = await Promise.all(
    supervisors.map(async (row) => {
      const stats = computeSupervisorCodeStats(codes, row.userId);
      const display = await resolveSupervisorDisplay(row.userId, row.note);
      return {
        userId: row.userId,
        kristoId: display.kristoId,
        churchId: display.churchId,
        fullName: display.fullName,
        avatarUrl: display.avatarUrl,
        platformRole: "Supervisor" as const,
        invitationStatus: "accepted" as const,
        assignedCodes: stats.assignedCodes,
        redeemedCodes: stats.redeemedCodes,
        remainingCodes: stats.remainingCodes,
        updatedAt: row.updatedAt,
        note: row.note,
      };
    })
  );

  const acceptedUserIds = new Set(rows.map((row) => row.userId));
  const pendingInvites = await listPendingSupervisorInvitations();

  for (const invite of pendingInvites) {
    if (acceptedUserIds.has(invite.inviteeUserId)) continue;

    let fullName: string | undefined;
    let avatarUrl: string | undefined;
    try {
      const profile = await getProfile(invite.inviteeUserId);
      fullName = String(profile?.fullName || "").trim() || undefined;
      avatarUrl = String(profile?.avatarUrl || "").trim() || undefined;
    } catch {
      fullName = undefined;
      avatarUrl = undefined;
    }

    rows.push({
      userId: invite.inviteeUserId,
      kristoId: invite.inviteeKristoId,
      churchId: invite.churchId,
      fullName,
      avatarUrl,
      invitationStatus: "pending",
      invitationId: invite.id,
      assignedCodes: 0,
      redeemedCodes: 0,
      remainingCodes: 0,
      updatedAt: invite.createdAt,
    });
  }

  return {
    supervisors: rows.sort((a, b) => Date.parse(String(b.updatedAt || "")) - Date.parse(String(a.updatedAt || ""))),
    availableUnassigned,
  };
}

export async function getSupervisorDetail(supervisorUserId: string): Promise<{
  supervisor: SupervisorSummary;
  codes: ActivationCode[];
}> {
  const uid = String(supervisorUserId || "").trim();
  if (!uid) throw new Error("supervisorUserId required");

  const role = await getPlatformRole(uid);
  if (role !== "Supervisor") {
    throw new Error("User is not a Supervisor");
  }

  const { supervisors: summaries } = await listSupervisorSummaries();
  let supervisor = summaries.find((row) => row.userId === uid);
  if (!supervisor) {
    const display = await resolveSupervisorDisplay(uid, undefined);
    const stats = computeSupervisorCodeStats(flattenCodes(await readStore()), uid);
    supervisor = {
      userId: uid,
      kristoId: display.kristoId,
      churchId: display.churchId,
      fullName: display.fullName,
      platformRole: "Supervisor",
      invitationStatus: "accepted",
      assignedCodes: stats.assignedCodes,
      redeemedCodes: stats.redeemedCodes,
      remainingCodes: stats.remainingCodes,
    };
  }

  const store = await readStore();
  const codes = flattenCodes(store)
    .filter((code) => String(code.assignedSupervisorUserId || "").trim() === uid)
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));

  return { supervisor, codes };
}

export type AssignCodesToSupervisorInput = {
  supervisorUserId: string;
  quantity: number;
  assignedBySystemAdminUserId: string;
};

export type AssignCodesToSupervisorResult = {
  supervisorUserId: string;
  assignedCount: number;
  codes: ActivationCode[];
};

export async function assignCodesToSupervisor(
  input: AssignCodesToSupervisorInput
): Promise<AssignCodesToSupervisorResult> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const assignedBySystemAdminUserId = String(input.assignedBySystemAdminUserId || "").trim();
  const quantity = Math.floor(Number(input.quantity));

  if (!supervisorUserId) throw new Error("supervisorUserId required");
  if (!assignedBySystemAdminUserId) throw new Error("assignedBySystemAdminUserId required");
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error("Quantity must be at least 1");
  }
  if (quantity > MAX_ASSIGN_QUANTITY) {
    throw new Error(`Quantity must be at most ${MAX_ASSIGN_QUANTITY}`);
  }

  const role = await getPlatformRole(supervisorUserId);
  if (role !== "Supervisor") {
    throw new Error("Target user is not a Supervisor");
  }

  const assignedAt = new Date().toISOString();
  let assignedCodes: ActivationCode[] = [];

  const beforeStore = await readStore();
  const beforeCodes = flattenCodes(beforeStore);
  logActivationCodeStoreSnapshot("before-assign", beforeStore, {
    assignableCodes: countAssignableActivationCodes(beforeCodes),
    requestedQuantity: quantity,
    supervisorUserId,
  });

  await updateOfflineActivationJsonFile<OfflineActivationCodeStore>(
    STORE_FILE,
    (current) => {
      const store: OfflineActivationCodeStore = {
        batches: Array.isArray(current?.batches) ? current.batches.map((batch) => ({
          ...batch,
          codes: Array.isArray(batch.codes) ? batch.codes.map((code) => normalizeActivationCode(code)) : [],
        })) : [],
      };

      const availablePool: Array<{ batchIndex: number; codeIndex: number; code: ActivationCode }> = [];
      store.batches.forEach((batch, batchIndex) => {
        (batch.codes || []).forEach((code, codeIndex) => {
          if (isAssignableActivationCode(code)) {
            availablePool.push({ batchIndex, codeIndex, code });
          }
        });
      });

      if (availablePool.length < quantity) {
        throw new Error(`Only ${availablePool.length} unassigned codes available`);
      }

      const picked = availablePool.slice(0, quantity);
      assignedCodes = picked.map(({ code }) =>
        normalizeActivationCode({
          ...code,
          status: "assigned_to_supervisor",
          assignedSupervisorUserId: supervisorUserId,
          assignedSupervisorAt: assignedAt,
          assignedBySystemAdminUserId,
        })
      );

      picked.forEach(({ batchIndex, codeIndex }, idx) => {
        store.batches[batchIndex].codes[codeIndex] = assignedCodes[idx];
      });

      return store;
    },
    { batches: [] }
  );

  const afterStore = await readStore();
  logActivationCodeStoreSnapshot("after-assign", afterStore, {
    assignedCount: assignedCodes.length,
    supervisorUserId,
  });

  return {
    supervisorUserId,
    assignedCount: assignedCodes.length,
    codes: assignedCodes,
  };
}

export type RemoveSupervisorInput = {
  userId: string;
  invitationId?: string;
  removedByUserId: string;
};

export type RemoveSupervisorResult = {
  outcome: "removed" | "invitation_cancelled";
  releasedCodes: number;
  userId: string;
};

async function releaseSupervisorAssignedCodes(supervisorUserId: string): Promise<number> {
  const uid = String(supervisorUserId || "").trim();
  if (!uid) return 0;

  let released = 0;

  await updateOfflineActivationJsonFile<OfflineActivationCodeStore>(
    STORE_FILE,
    (current) => {
      const store: OfflineActivationCodeStore = {
        batches: Array.isArray(current?.batches)
          ? current.batches.map((batch) => ({
              ...batch,
              codes: Array.isArray(batch.codes)
                ? batch.codes.map((code) => normalizeActivationCode(code))
                : [],
            }))
          : [],
      };

      store.batches.forEach((batch, batchIndex) => {
        (batch.codes || []).forEach((code, codeIndex) => {
          if (String(code.assignedSupervisorUserId || "").trim() !== uid) return;
          if (code.status === "redeemed") return;

          released += 1;
          store.batches[batchIndex].codes[codeIndex] = normalizeActivationCode({
            ...code,
            status: "available",
            ...emptyAssignmentFields(),
            createdAt: code.createdAt,
            createdByUserId: code.createdByUserId,
          });
        });
      });

      return store;
    },
    { batches: [] }
  );

  return released;
}

export async function removeSupervisor(input: RemoveSupervisorInput): Promise<RemoveSupervisorResult> {
  const userId = String(input.userId || "").trim();
  const invitationId = String(input.invitationId || "").trim() || undefined;
  const removedByUserId = String(input.removedByUserId || "").trim();

  if (!userId) throw new Error("userId required");

  const role = await getPlatformRole(userId);
  let releasedCodes = 0;
  let invitationCancelled = false;

  if (role === "Supervisor") {
    releasedCodes = await releaseSupervisorAssignedCodes(userId);
    await deletePlatformRole(userId);
  }

  const cancelled = await cancelSupervisorInvitation({
    invitationId,
    inviteeUserId: userId,
    cancelledByUserId: removedByUserId,
  });
  if (cancelled) invitationCancelled = true;

  if (role !== "Supervisor" && !invitationCancelled) {
    throw new Error("Supervisor not found");
  }

  console.log("KRISTO_SUPERVISOR_REMOVED", {
    removedByUserId,
    userId,
    outcome: role === "Supervisor" ? "removed" : "invitation_cancelled",
    releasedCodes,
    invitationCancelled,
  });

  return {
    outcome: role === "Supervisor" ? "removed" : "invitation_cancelled",
    releasedCodes,
    userId,
  };
}

export type SupervisorWorkspaceStats = {
  totalReceived: number;
  availableCodes: number;
  assignedToAgents: number;
  redeemedCodes: number;
  codesAssigned: number;
  codesRemaining: number;
};

export type AgentCodeStats = {
  assignedCodes: number;
  remainingCodes: number;
  redeemedCodes: number;
};

export type SupervisorInventoryBatch = {
  batchId: string;
  countryCode: string;
  durationMonths: number;
  total: number;
  remaining: number;
  assigned: number;
  redeemed: number;
  createdAt: string;
};

export type SupervisorCodeActivityItem = {
  id: string;
  type:
    | "assigned_to_agent"
    | "redeemed"
    | "returned"
    | "expired"
    | "received";
  title: string;
  subtitle?: string;
  code: string;
  occurredAt: string;
  agentId?: string | null;
  agentName?: string;
};

function filterSupervisorCodes(codes: ActivationCode[], supervisorUserId: string): ActivationCode[] {
  const uid = String(supervisorUserId || "").trim();
  return codes.filter((code) => String(code.assignedSupervisorUserId || "").trim() === uid);
}

export function computeSupervisorWorkspaceStats(
  codes: ActivationCode[],
  supervisorUserId: string
): SupervisorWorkspaceStats {
  const mine = filterSupervisorCodes(codes, supervisorUserId);
  const availableCodes = mine.filter((code) => code.status === "assigned_to_supervisor").length;
  const assignedToAgents = mine.filter((code) => code.status === "assigned_to_agent").length;
  const redeemedCodes = mine.filter((code) => code.status === "redeemed").length;
  const codesRemaining = mine.filter(
    (code) => code.status === "assigned_to_supervisor" || code.status === "assigned_to_agent"
  ).length;

  return {
    totalReceived: mine.length,
    availableCodes,
    assignedToAgents,
    redeemedCodes,
    codesAssigned: assignedToAgents,
    codesRemaining,
  };
}

export function computeAgentCodeStats(codes: ActivationCode[], agentId: string): AgentCodeStats {
  const id = String(agentId || "").trim();
  const mine = codes.filter((code) => String(code.assignedAgentUserId || "").trim() === id);
  const redeemedCodes = mine.filter((code) => code.status === "redeemed").length;
  const remainingCodes = mine.filter((code) => code.status === "assigned_to_agent").length;
  return {
    assignedCodes: mine.length,
    remainingCodes,
    redeemedCodes,
  };
}

export function buildSupervisorInventoryBatches(
  codes: ActivationCode[],
  supervisorUserId: string
): SupervisorInventoryBatch[] {
  const mine = filterSupervisorCodes(codes, supervisorUserId);
  const byBatch = new Map<string, SupervisorInventoryBatch>();

  for (const code of mine) {
    const batchId = String(code.batchId || "unknown");
    const existing =
      byBatch.get(batchId) ||
      ({
        batchId,
        countryCode: code.countryCode,
        durationMonths: code.durationMonths,
        total: 0,
        remaining: 0,
        assigned: 0,
        redeemed: 0,
        createdAt: code.createdAt,
      } satisfies SupervisorInventoryBatch);

    existing.total += 1;
    if (code.status === "assigned_to_supervisor") existing.remaining += 1;
    if (code.status === "assigned_to_agent") existing.assigned += 1;
    if (code.status === "redeemed") existing.redeemed += 1;
    if (Date.parse(String(code.createdAt || "")) < Date.parse(String(existing.createdAt || ""))) {
      existing.createdAt = code.createdAt;
    }
    byBatch.set(batchId, existing);
  }

  return [...byBatch.values()].sort(
    (a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))
  );
}

export async function buildSupervisorCodeActivity(
  codes: ActivationCode[],
  supervisorUserId: string,
  agentNameById: Record<string, string>
): Promise<SupervisorCodeActivityItem[]> {
  const mine = filterSupervisorCodes(codes, supervisorUserId);
  const events: SupervisorCodeActivityItem[] = [];

  for (const code of mine) {
    if (code.assignedSupervisorAt) {
      events.push({
        id: `${code.id}-received`,
        type: "received",
        title: "Codes received from System Admin",
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.assignedSupervisorAt),
      });
    }
    if (code.assignedAgentAt && code.assignedAgentUserId) {
      const agentName = agentNameById[code.assignedAgentUserId] || code.assignedAgentUserId;
      events.push({
        id: `${code.id}-agent`,
        type: "assigned_to_agent",
        title: `Assigned to Agent ${agentName}`,
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.assignedAgentAt),
        agentId: code.assignedAgentUserId,
        agentName,
      });
    }
    if (code.redeemedAt) {
      events.push({
        id: `${code.id}-redeemed`,
        type: "redeemed",
        title: `Redeemed by Church ${code.redeemedByChurchId || "—"}`,
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.redeemedAt),
      });
    }
    if (code.status === "disabled") {
      events.push({
        id: `${code.id}-expired`,
        type: "expired",
        title: "Code expired",
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.redeemedAt || code.assignedAgentAt || code.createdAt),
      });
    }
    if (
      code.status === "available" &&
      code.assignedSupervisorUserId &&
      !code.assignedAgentUserId &&
      !code.redeemedAt
    ) {
      events.push({
        id: `${code.id}-returned`,
        type: "returned",
        title: "Returned to pool",
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.assignedAgentAt || code.assignedSupervisorAt || code.createdAt),
      });
    }
  }

  return events.sort((a, b) => Date.parse(String(b.occurredAt || "")) - Date.parse(String(a.occurredAt || "")));
}

export type AssignCodesToAgentInput = {
  supervisorUserId: string;
  agentId: string;
  quantity: number;
};

export type AssignCodesToAgentResult = {
  supervisorUserId: string;
  agentId: string;
  assignedCount: number;
  codes: ActivationCode[];
};

export async function assignCodesToAgent(input: AssignCodesToAgentInput): Promise<AssignCodesToAgentResult> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const agentId = String(input.agentId || "").trim();
  const quantity = Math.floor(Number(input.quantity));

  if (!supervisorUserId) throw new Error("supervisorUserId required");
  if (!agentId) throw new Error("agentId required");
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error("Quantity must be at least 1");
  if (quantity > MAX_ASSIGN_QUANTITY) throw new Error(`Quantity must be at most ${MAX_ASSIGN_QUANTITY}`);

  const assignedAt = new Date().toISOString();
  let assignedCodes: ActivationCode[] = [];

  await updateOfflineActivationJsonFile<OfflineActivationCodeStore>(
    STORE_FILE,
    (current) => {
      const store: OfflineActivationCodeStore = {
        batches: Array.isArray(current?.batches)
          ? current.batches.map((batch) => ({
              ...batch,
              codes: Array.isArray(batch.codes) ? batch.codes.map((code) => normalizeActivationCode(code)) : [],
            }))
          : [],
      };

      const pool: Array<{ batchIndex: number; codeIndex: number; code: ActivationCode }> = [];
      store.batches.forEach((batch, batchIndex) => {
        (batch.codes || []).forEach((code, codeIndex) => {
          if (
            String(code.assignedSupervisorUserId || "").trim() === supervisorUserId &&
            code.status === "assigned_to_supervisor" &&
            !String(code.assignedAgentUserId || "").trim()
          ) {
            pool.push({ batchIndex, codeIndex, code });
          }
        });
      });

      if (pool.length < quantity) {
        throw new Error(`Only ${pool.length} available codes can be assigned to agents`);
      }

      const picked = pool.slice(0, quantity);
      assignedCodes = picked.map(({ code }) =>
        normalizeActivationCode({
          ...code,
          status: "assigned_to_agent",
          assignedAgentUserId: agentId,
          assignedAgentAt: assignedAt,
          assignedBySupervisorUserId: supervisorUserId,
        })
      );

      picked.forEach(({ batchIndex, codeIndex }, idx) => {
        store.batches[batchIndex].codes[codeIndex] = assignedCodes[idx];
      });

      return store;
    },
    { batches: [] }
  );

  return { supervisorUserId, agentId, assignedCount: assignedCodes.length, codes: assignedCodes };
}

export async function getSupervisorWorkspace(supervisorUserId: string) {
  const uid = String(supervisorUserId || "").trim();
  if (!uid) throw new Error("supervisorUserId required");

  const role = await getPlatformRole(uid);
  if (role !== "Supervisor") throw new Error("Supervisor access required");

  const store = await readStore();
  const codes = flattenCodes(store);
  const stats = computeSupervisorWorkspaceStats(codes, uid);
  const batches = buildSupervisorInventoryBatches(codes, uid);
  const supervisorCodes = filterSupervisorCodes(codes, uid).sort(
    (a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))
  );

  const profile = await getProfile(uid).catch(() => null);
  const platformRows = await listPlatformRoleUsers("Supervisor");
  const note = platformRows.find((row) => row.userId === uid)?.note;
  const churchId = parseSupervisorChurchIdFromNote(note);

  return {
    profile: {
      userId: uid,
      fullName: String(profile?.fullName || "").trim() || undefined,
      kristoId: String(profile?.userCode || "").trim().toUpperCase() || undefined,
      avatarUrl: String(profile?.avatarUrl || "").trim() || undefined,
      churchId,
    },
    stats,
    batches,
    codes: supervisorCodes,
  };
}

export type AgentWorkspaceStats = {
  assignedCodes: number;
  availableCodes: number;
  redeemedCodes: number;
  remainingCodes: number;
};

export type AgentChurchAssignment = {
  churchId: string;
  churchName: string;
  agentId: string;
  kristoId: string;
  status: "pending" | "accepted" | "declined" | "inactive";
  assignedCodes: number;
  remainingCodes: number;
  redeemedCodes: number;
};

function filterCodesForAgentIds(codes: ActivationCode[], agentIds: string[]): ActivationCode[] {
  const ids = new Set(agentIds.map((id) => String(id || "").trim()).filter(Boolean));
  if (ids.size === 0) return [];
  return codes.filter((code) => ids.has(String(code.assignedAgentUserId || "").trim()));
}

export function computeAgentWorkspaceStats(
  codes: ActivationCode[],
  agentIds: string[]
): AgentWorkspaceStats {
  const mine = filterCodesForAgentIds(codes, agentIds);
  const availableCodes = mine.filter((code) => code.status === "assigned_to_agent").length;
  const redeemedCodes = mine.filter((code) => code.status === "redeemed").length;
  return {
    assignedCodes: mine.length,
    availableCodes,
    redeemedCodes,
    remainingCodes: availableCodes,
  };
}

export function buildAgentInventoryBatches(
  codes: ActivationCode[],
  agentIds: string[]
): SupervisorInventoryBatch[] {
  const mine = filterCodesForAgentIds(codes, agentIds);
  const byBatch = new Map<string, SupervisorInventoryBatch>();

  for (const code of mine) {
    const batchId = String(code.batchId || "unknown");
    const existing =
      byBatch.get(batchId) ||
      ({
        batchId,
        countryCode: code.countryCode,
        durationMonths: code.durationMonths,
        total: 0,
        remaining: 0,
        assigned: 0,
        redeemed: 0,
        createdAt: code.createdAt,
      } satisfies SupervisorInventoryBatch);

    existing.total += 1;
    if (code.status === "assigned_to_agent") existing.remaining += 1;
    if (code.status === "redeemed") existing.redeemed += 1;
    if (Date.parse(String(code.createdAt || "")) < Date.parse(String(existing.createdAt || ""))) {
      existing.createdAt = code.createdAt;
    }
    byBatch.set(batchId, existing);
  }

  return [...byBatch.values()].sort(
    (a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))
  );
}

export function buildAgentCodeActivity(
  codes: ActivationCode[],
  agentIds: string[],
  churchNameById: Record<string, string>
): SupervisorCodeActivityItem[] {
  const mine = filterCodesForAgentIds(codes, agentIds);
  const events: SupervisorCodeActivityItem[] = [];

  for (const code of mine) {
    if (code.assignedAgentAt) {
      events.push({
        id: `${code.id}-received`,
        type: "received",
        title: "Codes received from Supervisor",
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.assignedAgentAt),
      });
    }
    if (code.redeemedAt) {
      const churchId = String(code.redeemedByChurchId || code.deliveredToChurchId || "").trim();
      const churchName = churchNameById[churchId] || churchId || "—";
      events.push({
        id: `${code.id}-redeemed`,
        type: "redeemed",
        title: `Redeemed by ${churchName}`,
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.redeemedAt),
      });
    }
    if (code.status === "disabled") {
      events.push({
        id: `${code.id}-expired`,
        type: "expired",
        title: "Code expired",
        subtitle: code.code,
        code: code.code,
        occurredAt: String(code.redeemedAt || code.assignedAgentAt || code.createdAt),
      });
    }
  }

  return events.sort((a, b) => Date.parse(String(b.occurredAt || "")) - Date.parse(String(a.occurredAt || "")));
}

export async function getAgentWorkspace(agentUserId: string) {
  const uid = String(agentUserId || "").trim();
  if (!uid) throw new Error("agentUserId required");

  const role = await getPlatformRole(uid);
  if (role !== "Agent") throw new Error("Agent access required");

  const registrations = (await listAgentsByLinkedUserId(uid)).filter((agent) =>
    isAcceptedAgentStatus(agent.status)
  );
  const agentIds = registrations.map((agent) => agent.id);

  const store = await readStore();
  const codes = flattenCodes(store);
  const stats = computeAgentWorkspaceStats(codes, agentIds);
  const batches = buildAgentInventoryBatches(codes, agentIds);
  const agentCodes = filterCodesForAgentIds(codes, agentIds).sort(
    (a, b) => Date.parse(String(b.assignedAgentAt || b.createdAt || "")) - Date.parse(String(a.assignedAgentAt || a.createdAt || ""))
  );

  const churches: AgentChurchAssignment[] = [];
  const churchNameById: Record<string, string> = {};

  for (const agent of registrations) {
    const churchId = String(agent.churchId || "").trim();
    const church = churchId ? await getChurchById(churchId).catch(() => null) : null;
    const churchName = String(church?.name || churchId || "Church").trim();
    if (churchId) churchNameById[churchId] = churchName;
    const agentStats = computeAgentCodeStats(codes, agent.id);
    churches.push({
      churchId,
      churchName,
      agentId: agent.id,
      kristoId: agent.kristoId,
      status: agent.status,
      assignedCodes: agentStats.assignedCodes,
      remainingCodes: agentStats.remainingCodes,
      redeemedCodes: agentStats.redeemedCodes,
    });
  }

  const activity = buildAgentCodeActivity(codes, agentIds, churchNameById);

  const profile = await getProfile(uid).catch(() => null);
  const primaryChurchId = churches[0]?.churchId;

  return {
    profile: {
      userId: uid,
      fullName: String(profile?.fullName || "").trim() || undefined,
      kristoId: String(profile?.userCode || "").trim().toUpperCase() || undefined,
      avatarUrl: String(profile?.avatarUrl || "").trim() || undefined,
      churchId: primaryChurchId,
    },
    stats,
    churches,
    batches,
    codes: agentCodes,
    activity,
    registrations,
  };
}

function normalizeActivationCodeInput(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export type ActivateChurchWithAgentCodeInput = {
  agentUserId: string;
  churchId: string;
  activationCode: string;
};

export type ActivateChurchWithAgentCodeResult = {
  code: ActivationCode;
  church: { churchId: string; churchName: string };
  redeemedByAgentId: string;
  redeemedByUserId: string;
};

export async function activateChurchWithAgentCode(
  input: ActivateChurchWithAgentCodeInput
): Promise<ActivateChurchWithAgentCodeResult> {
  const agentUserId = String(input.agentUserId || "").trim();
  const churchId = normalizeMembershipChurchId(input.churchId);
  const codeToken = normalizeActivationCodeInput(input.activationCode);

  if (!agentUserId) throw new Error("agentUserId required");
  if (!churchId) throw new Error("churchId required");
  if (!codeToken) throw new Error("activationCode required");

  const role = await getPlatformRole(agentUserId);
  if (role !== "Agent") throw new Error("Agent access required");

  const registrations = await listAgentsByLinkedUserId(agentUserId);
  const agentIds = new Set(registrations.map((agent) => agent.id));
  if (agentIds.size === 0) throw new Error("No agent registration found for this user");

  const church = await getChurchById(churchId);
  if (!church) throw new Error("Church not found");

  const redeemedAt = new Date().toISOString();
  let updatedCode: ActivationCode | null = null;
  let redeemedByAgentId = "";

  await updateOfflineActivationJsonFile<OfflineActivationCodeStore>(
    STORE_FILE,
    (current) => {
      const store: OfflineActivationCodeStore = {
        batches: Array.isArray(current?.batches)
          ? current.batches.map((batch) => ({
              ...batch,
              codes: Array.isArray(batch.codes) ? batch.codes.map((code) => normalizeActivationCode(code)) : [],
            }))
          : [],
      };

      let match: { batchIndex: number; codeIndex: number; code: ActivationCode } | null = null;

      store.batches.forEach((batch, batchIndex) => {
        (batch.codes || []).forEach((code, codeIndex) => {
          if (match) return;
          if (normalizeActivationCodeInput(code.code) !== codeToken) return;
          match = { batchIndex, codeIndex, code };
        });
      });

      if (!match) throw new Error("Activation code not found");

      const { batchIndex, codeIndex, code } = match;
      const assignedAgentId = String(code.assignedAgentUserId || "").trim();

      if (!assignedAgentId || !agentIds.has(assignedAgentId)) {
        throw new Error("Activation code is not assigned to you");
      }
      if (code.status === "redeemed") throw new Error("Activation code has already been redeemed");
      if (code.status === "disabled") throw new Error("Activation code is expired or disabled");
      if (code.status !== "assigned_to_agent") {
        throw new Error("Activation code is not available for redemption");
      }

      redeemedByAgentId = assignedAgentId;
      updatedCode = normalizeActivationCode({
        ...code,
        status: "redeemed",
        redeemedAt,
        redeemedByChurchId: churchId,
        redeemedByUserId: agentUserId,
        deliveredToChurchId: churchId,
      });

      store.batches[batchIndex].codes[codeIndex] = updatedCode;
      return store;
    },
    { batches: [] }
  );

  if (!updatedCode) throw new Error("Failed to redeem activation code");

  const churchName = String(church.name || churchId).trim() || churchId;

  console.log("KRISTO_AGENT_ACTIVATE_CHURCH", {
    agentUserId,
    redeemedByAgentId,
    churchId,
    codeId: updatedCode.id,
  });

  return {
    code: updatedCode,
    church: { churchId, churchName },
    redeemedByAgentId,
    redeemedByUserId: agentUserId,
  };
}

export type ActivationChurchActivityItem = {
  redeemedAt: string;
  code: string;
  supervisorName?: string;
  supervisorUserId?: string | null;
  agentName?: string;
  agentUserId?: string | null;
  durationMonths: number;
  durationLabel: string;
  status: "Redeemed";
};

export type ActivationChurchActivityRow = {
  churchId: string;
  churchName: string;
  month: string;
  trendPercent: number | null;
  usedCount: number;
  activations: ActivationChurchActivityItem[];
};

function normalizeMonthKey(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const [yearRaw, monthRaw] = raw.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function redeemedAtMonthKey(redeemedAt: string): string | null {
  const parsed = Date.parse(String(redeemedAt || ""));
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatDurationLabel(months: number): string {
  const value = Math.floor(Number(months));
  if (value === 1) return "Monthly";
  if (value === 12) return "Yearly";
  if (value === 3) return "3 months";
  if (value === 6) return "6 months";
  return `${value} months`;
}

async function resolveActivationUserName(userId: string | null | undefined): Promise<string | undefined> {
  const uid = String(userId || "").trim();
  if (!uid) return undefined;
  try {
    const profile = await getProfile(uid);
    const name = String(profile?.fullName || "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

export async function getOfflineActivationChurchActivity(monthInput?: string): Promise<{
  month: string;
  churches: ActivationChurchActivityRow[];
}> {
  const month = normalizeMonthKey(monthInput) || currentMonthKey();
  const prevMonth = previousMonthKey(month);
  const store = await readStore();
  const redeemedCodes = flattenCodes(store).filter(
    (code) => code.status === "redeemed" && String(code.redeemedAt || "").trim()
  );

  const currentByChurch = new Map<string, ActivationCode[]>();
  const prevCountByChurch = new Map<string, number>();

  for (const code of redeemedCodes) {
    const churchId = normalizeMembershipChurchId(
      code.redeemedByChurchId || code.deliveredToChurchId || ""
    );
    if (!churchId) continue;

    const monthKey = redeemedAtMonthKey(String(code.redeemedAt || ""));
    if (!monthKey) continue;

    if (monthKey === month) {
      const existing = currentByChurch.get(churchId) || [];
      existing.push(code);
      currentByChurch.set(churchId, existing);
      continue;
    }

    if (monthKey === prevMonth) {
      prevCountByChurch.set(churchId, (prevCountByChurch.get(churchId) || 0) + 1);
    }
  }

  const churches: ActivationChurchActivityRow[] = [];

  for (const [churchId, monthCodes] of currentByChurch.entries()) {
    const church = await getChurchById(churchId);
    const churchName = String(church?.name || churchId).trim() || churchId;
    const usedCount = monthCodes.length;
    const prevCount = prevCountByChurch.get(churchId) || 0;
    let trendPercent: number | null = null;
    if (prevCount > 0) {
      trendPercent = Math.round(((usedCount - prevCount) / prevCount) * 100);
    }

    const sortedCodes = [...monthCodes].sort(
      (a, b) => Date.parse(String(b.redeemedAt || "")) - Date.parse(String(a.redeemedAt || ""))
    );

    const activations: ActivationChurchActivityItem[] = [];
    for (const code of sortedCodes) {
      const supervisorUserId = String(code.assignedSupervisorUserId || "").trim() || null;
      const agentUserId = String(code.assignedAgentUserId || "").trim() || null;
      const [supervisorName, agentName] = await Promise.all([
        resolveActivationUserName(supervisorUserId),
        resolveActivationUserName(agentUserId),
      ]);

      activations.push({
        redeemedAt: String(code.redeemedAt || ""),
        code: String(code.code || ""),
        supervisorName,
        supervisorUserId,
        agentName,
        agentUserId,
        durationMonths: Number(code.durationMonths || 0),
        durationLabel: formatDurationLabel(code.durationMonths),
        status: "Redeemed",
      });
    }

    churches.push({
      churchId,
      churchName,
      month,
      trendPercent,
      usedCount,
      activations,
    });
  }

  churches.sort(
    (a, b) => b.usedCount - a.usedCount || a.churchName.localeCompare(b.churchName)
  );

  return { month, churches };
}
