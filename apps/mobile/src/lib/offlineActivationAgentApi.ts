import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { buildKristoRequestHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import type { ActivationCode } from "@/src/lib/offlineActivationCodesApi";

function buildHeaders(path: string) {
  const session = getSessionSync();
  const userId = String(session?.userId || "").trim();
  const role = String(session?.role || session?.churchRole || "Member").trim();
  const churchId = String(session?.churchId || session?.activeChurchId || "").trim();
  const platformRole = resolveSessionPlatformRole(session);
  const sessionToken = String(session?.sessionToken || "").trim();

  return buildKristoRequestHeaders(
    path,
    { userId, role: role as any, churchId, sessionToken },
    { accept: "application/json", "content-type": "application/json" },
    "offlineActivationAgentApi"
  );
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
  status: "active" | "inactive";
  assignedCodes: number;
  remainingCodes: number;
  redeemedCodes: number;
};

export type AgentInventoryBatch = {
  batchId: string;
  countryCode: string;
  durationMonths: number;
  total: number;
  remaining: number;
  assigned: number;
  redeemed: number;
  createdAt: string;
};

export type AgentCodeActivityItem = {
  id: string;
  type: "assigned_to_agent" | "redeemed" | "returned" | "expired" | "received";
  title: string;
  subtitle?: string;
  code: string;
  occurredAt: string;
  agentId?: string | null;
  agentName?: string;
};

export type AgentDashboardResponse = {
  profile: {
    userId: string;
    fullName?: string;
    kristoId?: string;
    avatarUrl?: string;
    churchId?: string;
  };
  stats: AgentWorkspaceStats;
  churches: AgentChurchAssignment[];
  batches: AgentInventoryBatch[];
  codes: ActivationCode[];
  activity: AgentCodeActivityItem[];
};

export async function fetchAgentDashboard(): Promise<AgentDashboardResponse> {
  const path = "/api/offline-activation/agent/dashboard";
  const res = await apiGet<{ ok: true } & AgentDashboardResponse | { ok: false; error: string }>(
    path,
    { headers: buildHeaders(path) }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load agent dashboard"));
  }
  return res as AgentDashboardResponse;
}

export type ActivateChurchForAgentInput = {
  churchId: string;
  activationCode: string;
};

export type ActivateChurchForAgentResponse = {
  code: ActivationCode;
  church: { churchId: string; churchName: string };
  redeemedByAgentId: string;
  redeemedByUserId: string;
};

export async function activateChurchForAgent(
  input: ActivateChurchForAgentInput
): Promise<ActivateChurchForAgentResponse> {
  const path = "/api/offline-activation/agent/activate-church";
  const res = await apiPost<
    { ok: true } & ActivateChurchForAgentResponse | { ok: false; error: string }
  >(path, input, { headers: buildHeaders(path) });
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to activate church"));
  }
  return res as ActivateChurchForAgentResponse;
}
