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
    "offlineActivationSupervisorApi"
  );
}

export type SupervisorWorkspaceStats = {
  totalReceived: number;
  availableCodes: number;
  assignedToAgents: number;
  redeemedCodes: number;
  codesAssigned: number;
  codesRemaining: number;
};

export type SupervisorAgentStats = {
  assignedCodes: number;
  remainingCodes: number;
  redeemedCodes: number;
};

export type SupervisorAgent = {
  id: string;
  supervisorUserId: string;
  kristoId: string;
  churchId: string;
  fullName: string;
  phone: string;
  status: "active" | "inactive";
  avatarUrl?: string;
  linkedUserId?: string;
  createdAt: string;
  updatedAt: string;
  stats: SupervisorAgentStats;
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
  type: "assigned_to_agent" | "redeemed" | "returned" | "expired" | "received";
  title: string;
  subtitle?: string;
  code: string;
  occurredAt: string;
  agentId?: string | null;
  agentName?: string;
};

export type SupervisorDashboardResponse = {
  profile: {
    userId: string;
    fullName?: string;
    kristoId?: string;
    avatarUrl?: string;
    churchId?: string;
  };
  stats: SupervisorWorkspaceStats;
  batches: SupervisorInventoryBatch[];
  codes: ActivationCode[];
  agents: SupervisorAgent[];
  activity: SupervisorCodeActivityItem[];
};

export async function fetchSupervisorAgents(): Promise<SupervisorAgent[]> {
  const path = "/api/offline-activation/supervisor/agents";
  const res = await apiGet<{ ok: true; agents: SupervisorAgent[] } | { ok: false; error: string }>(
    path,
    { headers: buildHeaders(path) }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load agents"));
  }
  return Array.isArray((res as any).agents) ? (res as any).agents : [];
}

export async function fetchSupervisorDashboard(): Promise<SupervisorDashboardResponse> {
  const path = "/api/offline-activation/supervisor/dashboard";
  const res = await apiGet<{ ok: true } & SupervisorDashboardResponse | { ok: false; error: string }>(
    path,
    { headers: buildHeaders(path) }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load supervisor dashboard"));
  }
  return res as SupervisorDashboardResponse;
}

export async function addSupervisorAgent(input: {
  kristoId: string;
  churchId: string;
  status?: "active" | "inactive";
}) {
  const path = "/api/offline-activation/supervisor/agents";
  const res = await apiPost<{ ok: true; agent: SupervisorAgent } | { ok: false; error: string }>(
    path,
    input,
    { headers: buildHeaders(path) }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to add agent"));
  }
  return (res as any).agent;
}

export async function updateSupervisorAgent(input: {
  agentId: string;
  status?: "active" | "inactive";
}) {
  const path = "/api/offline-activation/supervisor/agents/update";
  const res = await apiPost<{ ok: true; agent: SupervisorAgent } | { ok: false; error: string }>(
    path,
    input,
    { headers: buildHeaders(path) }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to update agent"));
  }
  return (res as any).agent;
}

export async function deleteSupervisorAgent(agentId: string) {
  const path = "/api/offline-activation/supervisor/agents/delete";
  const res = await apiPost<{ ok: true; agentId: string } | { ok: false; error: string }>(
    path,
    { agentId },
    { headers: buildHeaders(path) }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to delete agent"));
  }
}

export async function assignCodesToAgent(agentId: string, quantity: number) {
  const path = "/api/offline-activation/supervisor/agents/assign-codes";
  const res = await apiPost<
    { ok: true; assignedCount: number; agentId: string } | { ok: false; error: string }
  >(path, { agentId, quantity }, { headers: buildHeaders(path) });
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to assign codes"));
  }
  return { assignedCount: Number((res as any).assignedCount || 0) };
}
