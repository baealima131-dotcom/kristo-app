import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { buildKristoRequestHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";

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

export type ActivationCodesListResponse = {
  ok: true;
  batches: ActivationCodeBatch[];
  codes: ActivationCode[];
  totals: {
    batches: number;
    codes: number;
    available: number;
    availableUnassigned?: number;
    assignedToSupervisors?: number;
    disabled: number;
    redeemed: number;
  };
};

export type GenerateActivationCodesResponse = {
  ok: true;
  batch: ActivationCodeBatch;
  codes: ActivationCode[];
};

export const ACTIVATION_COUNTRY_OPTIONS = ["BDI", "CD", "TZ", "US"] as const;
export const ACTIVATION_DURATION_OPTIONS = [1, 3, 6, 12] as const;

function buildActivationRequestHeaders(path: string) {
  const session = getSessionSync();
  const userId = String(session?.userId || "").trim();
  const role = String(session?.role || session?.churchRole || "Member").trim();
  const churchId = String(session?.churchId || session?.activeChurchId || "").trim();
  const platformRole = resolveSessionPlatformRole(session);
  const sessionToken = String(session?.sessionToken || "").trim();

  console.log("KRISTO_ACTIVATION_CODES_AUTH_CONTEXT", {
    path: String(path || "").split("?")[0],
    userId: userId || null,
    role: role || null,
    churchId: churchId || null,
    platformRole,
    hasSessionToken: Boolean(sessionToken),
  });

  const headers = buildKristoRequestHeaders(
    path,
    {
      userId,
      role: role as any,
      churchId,
      sessionToken,
    },
    {
      accept: "application/json",
      "content-type": "application/json",
    },
    "offlineActivationCodesApi"
  );

  return headers;
}

export async function fetchActivationCodes(limit = 200): Promise<ActivationCodesListResponse> {
  const path = `/api/offline-activation/codes?limit=${encodeURIComponent(String(limit))}`;
  console.log("KRISTO_ACTIVATION_CODES_LIST_LOAD", { limit });

  const res = await apiGet<ActivationCodesListResponse | { ok: false; error: string }>(
    path,
    { headers: buildActivationRequestHeaders(path) },
    {
      screen: "system-admin-subscription-codes",
    }
  );

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load activation codes"));
  }

  return res as ActivationCodesListResponse;
}

export type GenerateActivationCodesInput = {
  countryCode: string;
  durationMonths: number;
  quantity: number;
};

export async function generateActivationCodes(
  input: GenerateActivationCodesInput
): Promise<GenerateActivationCodesResponse> {
  const path = "/api/offline-activation/codes/generate";

  console.log("KRISTO_ACTIVATION_CODES_GENERATE_START", {
    countryCode: input.countryCode,
    durationMonths: input.durationMonths,
    quantity: input.quantity,
  });

  const res = await apiPost<GenerateActivationCodesResponse | { ok: false; error: string }>(
    path,
    input,
    { headers: buildActivationRequestHeaders(path) }
  );

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to generate activation codes"));
  }

  console.log("KRISTO_ACTIVATION_CODES_GENERATE_SUCCESS", {
    batchId: (res as GenerateActivationCodesResponse).batch?.batchId,
    quantity: (res as GenerateActivationCodesResponse).codes?.length || 0,
  });

  return res as GenerateActivationCodesResponse;
}

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

export type SupervisorSummary = {
  userId: string;
  email?: string;
  fullName?: string;
  platformRole: "Supervisor";
  assignedCodes: number;
  redeemedCodes: number;
  remainingCodes: number;
  updatedAt?: string;
  note?: string;
};

export async function fetchActivationDashboard(): Promise<{ stats: ActivationDashboardStats }> {
  const path = "/api/offline-activation/dashboard";
  console.log("KRISTO_ACTIVATION_DASHBOARD_LOAD");

  const res = await apiGet<{ ok: true; stats: ActivationDashboardStats } | { ok: false; error: string }>(
    path,
    { headers: buildActivationRequestHeaders(path) },
    { screen: "system-admin-dashboard" }
  );

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load activation dashboard"));
  }

  return { stats: (res as any).stats };
}

export async function fetchSupervisors(): Promise<SupervisorSummary[]> {
  const path = "/api/offline-activation/supervisors";
  console.log("KRISTO_SUPERVISORS_LIST_LOAD");

  const res = await apiGet<{ ok: true; supervisors: SupervisorSummary[] } | { ok: false; error: string }>(
    path,
    { headers: buildActivationRequestHeaders(path) },
    { screen: "system-admin-supervisors" }
  );

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load supervisors"));
  }

  return Array.isArray((res as any).supervisors) ? (res as any).supervisors : [];
}

export async function addSupervisor(identifier: string): Promise<SupervisorSummary> {
  const path = "/api/offline-activation/supervisors/add";
  console.log("KRISTO_SUPERVISOR_ADD_START", { identifier: String(identifier || "").trim() });

  try {
    const res = await apiPost<
      | { ok: true; supervisor: { userId: string; email?: string; fullName?: string; platformRole: string } }
      | { ok: false; error: string }
    >(path, { identifier }, { headers: buildActivationRequestHeaders(path) });

    if (!res || (res as any).ok === false) {
      throw new Error(String((res as any)?.error || "Failed to add supervisor"));
    }

    const supervisor = (res as any).supervisor;
    console.log("KRISTO_SUPERVISOR_ADD_SUCCESS", { userId: supervisor?.userId || null });

    return {
      userId: supervisor.userId,
      email: supervisor.email,
      fullName: supervisor.fullName,
      platformRole: "Supervisor",
      assignedCodes: 0,
      redeemedCodes: 0,
      remainingCodes: 0,
    };
  } catch (error: any) {
    console.log("KRISTO_SUPERVISOR_ADD_FAILED", {
      identifier: String(identifier || "").trim(),
      error: String(error?.message || error || "failed"),
    });
    throw error;
  }
}

export async function assignCodesToSupervisor(
  supervisorUserId: string,
  quantity: number
): Promise<{ assignedCount: number }> {
  const path = "/api/offline-activation/supervisors/assign-codes";
  console.log("KRISTO_SUPERVISOR_ASSIGN_CODES_START", {
    supervisorUserId,
    quantity,
  });

  try {
    const res = await apiPost<
      | { ok: true; assignedCount: number; supervisorUserId: string }
      | { ok: false; error: string }
    >(
      path,
      { supervisorUserId, quantity },
      { headers: buildActivationRequestHeaders(path) }
    );

    if (!res || (res as any).ok === false) {
      throw new Error(String((res as any)?.error || "Failed to assign codes"));
    }

    console.log("KRISTO_SUPERVISOR_ASSIGN_CODES_SUCCESS", {
      supervisorUserId,
      assignedCount: (res as any).assignedCount,
    });

    return { assignedCount: Number((res as any).assignedCount || 0) };
  } catch (error: any) {
    console.log("KRISTO_SUPERVISOR_ASSIGN_CODES_FAILED", {
      supervisorUserId,
      quantity,
      error: String(error?.message || error || "failed"),
    });
    throw error;
  }
}

export async function fetchSupervisorDetail(supervisorUserId: string): Promise<{
  supervisor: SupervisorSummary;
  codes: ActivationCode[];
}> {
  const path = `/api/offline-activation/supervisors/detail?supervisorUserId=${encodeURIComponent(supervisorUserId)}`;
  const res = await apiGet<
    | { ok: true; supervisor: SupervisorSummary; codes: ActivationCode[] }
    | { ok: false; error: string }
  >(path, { headers: buildActivationRequestHeaders(path) }, { screen: "system-admin-supervisor-detail" });

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load supervisor detail"));
  }

  return {
    supervisor: (res as any).supervisor,
    codes: Array.isArray((res as any).codes) ? (res as any).codes : [],
  };
}
