import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
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

const STORE_FILE = "offline_activation_codes.json";

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
    assignedSupervisorUserId: raw.assignedSupervisorUserId ?? null,
    assignedSupervisorAt: raw.assignedSupervisorAt ?? null,
    assignedBySystemAdminUserId: raw.assignedBySystemAdminUserId ?? null,
    assignedAgentUserId: raw.assignedAgentUserId ?? null,
    assignedAgentAt: raw.assignedAgentAt ?? null,
    assignedBySupervisorUserId: raw.assignedBySupervisorUserId ?? null,
    deliveredToChurchId: raw.deliveredToChurchId ?? null,
    redeemedAt: raw.redeemedAt ?? null,
    redeemedByChurchId: raw.redeemedByChurchId ?? null,
    redeemedByUserId: raw.redeemedByUserId ?? null,
  };
}

export function isUnassignedAvailableCode(code: ActivationCode): boolean {
  return code.status === "available" && !String(code.assignedSupervisorUserId || "").trim();
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
  const rows = await readJsonFile<OfflineActivationCodeStore>(STORE_FILE, { batches: [] });
  const batches = Array.isArray(rows?.batches) ? rows.batches : [];
  return {
    batches: batches.map((batch) => ({
      ...batch,
      codes: Array.isArray(batch.codes) ? batch.codes.map((code) => normalizeActivationCode(code)) : [],
    })),
  };
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

  await updateJsonFile<OfflineActivationCodeStore>(
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
  const batches = [...store.batches].sort(
    (a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))
  );

  const allCodes = flattenCodes(store);
  const codes = [...allCodes]
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(limit, 1000)));

  const totals = {
    batches: batches.length,
    codes: allCodes.length,
    available: allCodes.filter((c) => c.status === "available").length,
    availableUnassigned: allCodes.filter(isUnassignedAvailableCode).length,
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
  const supervisors = await listPlatformRoleUsers("Supervisor");
  const agents = await listPlatformRoleUsers("Agent");

  return {
    stats: computeDashboardStats(codes, supervisors.length, agents.length),
  };
}

export async function listSupervisorSummaries(): Promise<SupervisorSummary[]> {
  const store = await readStore();
  const codes = flattenCodes(store);
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

  return rows.sort((a, b) => Date.parse(String(b.updatedAt || "")) - Date.parse(String(a.updatedAt || "")));
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

  const summaries = await listSupervisorSummaries();
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

  await updateJsonFile<OfflineActivationCodeStore>(
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
          if (isUnassignedAvailableCode(code)) {
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

  await updateJsonFile<OfflineActivationCodeStore>(
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
