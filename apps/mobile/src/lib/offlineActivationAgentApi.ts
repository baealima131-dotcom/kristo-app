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
  status: "pending" | "accepted" | "declined" | "inactive";
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

export type AgentAccessResponse = {
  ok: true;
  platformRole: string | null;
  hasAgentRole: boolean;
  hasAcceptedRegistration: boolean;
  canOpenWorkspace: boolean;
  pendingInvitations: AgentInvitationSummary[];
  registrations: Array<{
    id: string;
    supervisorUserId: string;
    kristoId: string;
    churchId: string;
    fullName: string;
    phone: string;
    status: "pending" | "accepted" | "declined" | "inactive" | "active";
    linkedUserId?: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type AgentInvitationSummary = {
  id: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
  role: "Agent";
  status: "pending";
  createdAt: string;
  respondedAt?: string | null;
};

export type AgentInvitationRecord = AgentInvitationSummary & {
  agentRegistration: {
    id: string;
    status: "pending" | "accepted" | "declined" | "inactive";
    kristoId: string;
    churchId: string;
    fullName: string;
    linkedUserId?: string;
  } | null;
};

export type AgentInvitationRespondResult = {
  invitation: AgentInvitationSummary & { status: string; respondedAt?: string | null };
  platformRole?: string | null;
  offlineActivationRole?: string | null;
};

function agentHeaders(path: string) {
  return { headers: buildHeaders(path) };
}

export async function fetchAgentAccess(): Promise<AgentAccessResponse> {
  const path = "/api/offline-activation/agent/access";
  const res = await apiGet<AgentAccessResponse | { ok: false; error: string }>(
    path,
    agentHeaders(path),
    { screen: "agent-access" }
  );
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load agent access"));
  }
  return res as AgentAccessResponse;
}

export async function fetchAgentInvitations(): Promise<AgentInvitationRecord[]> {
  const path = "/api/offline-activation/agent/invitations";
  const res = await apiGet<
    { ok: true; invitations: AgentInvitationRecord[] } | { ok: false; error: string }
  >(path, agentHeaders(path), { screen: "agent-invitations" });
  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load agent invitations"));
  }
  return Array.isArray((res as any).invitations) ? (res as any).invitations : [];
}

export async function acceptAgentInvitation(invitationId: string): Promise<AgentInvitationRespondResult> {
  const path = "/api/offline-activation/agent/invitations/accept";
  const id = String(invitationId || "").trim();
  if (!id) throw new Error("invitationId is required");

  const res = await apiPost<
    { ok: true } & AgentInvitationRespondResult | { ok: false; error: string }
  >(path, { invitationId: id }, agentHeaders(path));

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to accept agent invitation"));
  }

  return {
    invitation: (res as any).invitation,
    platformRole: (res as any).platformRole ?? null,
    offlineActivationRole: (res as any).offlineActivationRole ?? (res as any).platformRole ?? null,
  };
}

export async function declineAgentInvitation(invitationId: string): Promise<AgentInvitationRespondResult> {
  const path = "/api/offline-activation/agent/invitations/decline";
  const id = String(invitationId || "").trim();
  if (!id) throw new Error("invitationId is required");

  const res = await apiPost<
    { ok: true } & AgentInvitationRespondResult | { ok: false; error: string }
  >(path, { invitationId: id }, agentHeaders(path));

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to decline agent invitation"));
  }

  return {
    invitation: (res as any).invitation,
    platformRole: null,
    offlineActivationRole: null,
  };
}
