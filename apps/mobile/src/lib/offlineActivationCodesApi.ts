import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { buildKristoRequestHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";

export type ActivationCodeStatus = "available" | "disabled" | "redeemed";
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
