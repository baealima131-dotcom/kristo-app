import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

import type {
  SokoProtectionAdminAction,
  SokoProtectionResolutionCode,
} from "@/src/lib/sokoProtectionAdminLabels";

export type SokoProtectionAdminCase = {
  id: string;
  orderId: string;
  buyerUserId: string;
  sellerUserId: string;
  conversationId: string | null;
  requestType: string;
  reasonCode: string;
  description: string;
  state: string;
  immutableSnapshotHash: string;
  immutableOrderSnapshot: Record<string, unknown>;
  paymentVerificationKind: string;
  paymentClaim?: string;
  sellerResponseDeadline: string | null;
  evidenceDeadline: string | null;
  externalRefundDeadline: string | null;
  resolutionCode: string | null;
  resolutionSummary: string | null;
  resolutionNotice?: string | null;
  isEscrow?: boolean;
  isGuaranteedRefund?: boolean;
  isVerifiedDelivery?: boolean;
  holdsBuyerFunds?: boolean;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  events?: SokoProtectionAdminEvent[];
  evidence?: SokoProtectionAdminEvidence[];
  liveOrderStatus?: string | null;
  liveTrackingNumber?: string | null;
  enforcement?: {
    mode?: string;
    blocksOrderFulfillment?: boolean;
  };
};

export type SokoProtectionAdminEvent = {
  id: string;
  caseId: string;
  actorUserId: string;
  actorRole: string;
  eventType: string;
  priorState: string | null;
  nextState: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SokoProtectionAdminEvidence = {
  id: string;
  caseId: string;
  submittedByUserId: string;
  evidenceType: string;
  trustedReferenceType: string;
  trustedReferenceId: string;
  caption: string;
  immutableSnapshot: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
};

export class SokoProtectionAdminApiError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = "SokoProtectionAdminApiError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

function assertOk(response: any, fallback: string) {
  if (!response || response.ok === false) {
    throw new SokoProtectionAdminApiError(
      String(response?.error || fallback),
      {
        status: Number(response?.status || 0) || undefined,
        code: response?.code ? String(response.code) : undefined,
      }
    );
  }
  return response;
}

function mapCase(row: any): SokoProtectionAdminCase {
  return {
    id: String(row?.id || ""),
    orderId: String(row?.orderId || ""),
    buyerUserId: String(row?.buyerUserId || ""),
    sellerUserId: String(row?.sellerUserId || ""),
    conversationId: row?.conversationId ? String(row.conversationId) : null,
    requestType: String(row?.requestType || ""),
    reasonCode: String(row?.reasonCode || ""),
    description: String(row?.description || ""),
    state: String(row?.state || ""),
    immutableSnapshotHash: String(row?.immutableSnapshotHash || ""),
    immutableOrderSnapshot:
      row?.immutableOrderSnapshot &&
      typeof row.immutableOrderSnapshot === "object"
        ? row.immutableOrderSnapshot
        : {},
    paymentVerificationKind: String(
      row?.paymentVerificationKind || "unverified"
    ),
    paymentClaim: row?.paymentClaim ? String(row.paymentClaim) : undefined,
    sellerResponseDeadline: row?.sellerResponseDeadline
      ? String(row.sellerResponseDeadline)
      : null,
    evidenceDeadline: row?.evidenceDeadline
      ? String(row.evidenceDeadline)
      : null,
    externalRefundDeadline: row?.externalRefundDeadline
      ? String(row.externalRefundDeadline)
      : null,
    resolutionCode: row?.resolutionCode ? String(row.resolutionCode) : null,
    resolutionSummary: row?.resolutionSummary
      ? String(row.resolutionSummary)
      : null,
    resolutionNotice: row?.resolutionNotice
      ? String(row.resolutionNotice)
      : null,
    isEscrow: Boolean(row?.isEscrow),
    isGuaranteedRefund: Boolean(row?.isGuaranteedRefund),
    isVerifiedDelivery: Boolean(row?.isVerifiedDelivery),
    holdsBuyerFunds: Boolean(row?.holdsBuyerFunds),
    summary: row?.summary ? String(row.summary) : undefined,
    createdAt: String(row?.createdAt || ""),
    updatedAt: String(row?.updatedAt || ""),
    closedAt: row?.closedAt ? String(row.closedAt) : null,
    events: Array.isArray(row?.events) ? row.events : [],
    evidence: Array.isArray(row?.evidence) ? row.evidence : [],
    liveOrderStatus:
      row?.liveOrderStatus != null ? String(row.liveOrderStatus) : null,
    liveTrackingNumber:
      row?.liveTrackingNumber != null ? String(row.liveTrackingNumber) : null,
    enforcement: row?.enforcement,
  };
}

/**
 * List admin protection cases.
 * Auth is server-side System_Admin via session token — never trust UI role headers alone.
 */
export async function listAdminProtectionCases(input?: {
  state?: string;
  paymentVerificationKind?: string;
}) {
  const params = new URLSearchParams();
  if (input?.state) params.set("state", input.state);
  if (input?.paymentVerificationKind) {
    params.set("paymentVerificationKind", input.paymentVerificationKind);
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const response: any = await apiGet(
    `/api/soko/admin/protection/cases${query}`,
    { headers: getKristoHeaders() as any }
  );
  assertOk(response, "Could not load Buyer Protection queue.");
  const cases = Array.isArray(response.cases) ? response.cases : [];
  return cases.map(mapCase);
}

export async function getAdminProtectionCase(caseId: string) {
  const id = String(caseId || "").trim();
  if (!id) {
    throw new SokoProtectionAdminApiError("Case id is required.", {
      code: "missing_case_id",
      status: 400,
    });
  }
  const response: any = await apiGet(
    `/api/soko/admin/protection/cases/${encodeURIComponent(id)}`,
    { headers: getKristoHeaders() as any }
  );
  assertOk(response, "Could not load protection case.");
  return mapCase(response.case || {});
}

export async function postAdminProtectionAction(input: {
  caseId: string;
  action: SokoProtectionAdminAction;
  note: string;
  resolutionCode?: SokoProtectionResolutionCode | string;
  resolutionSummary?: string;
}) {
  const caseId = String(input.caseId || "").trim();
  const note = String(input.note || "").trim();
  if (!caseId) {
    throw new SokoProtectionAdminApiError("Case id is required.", {
      code: "missing_case_id",
      status: 400,
    });
  }
  if (!note) {
    throw new SokoProtectionAdminApiError(
      "An admin note is required for this action.",
      { code: "missing_note", status: 400 }
    );
  }

  const body: Record<string, string> = {
    action: input.action,
    note,
  };
  if (input.resolutionCode) {
    body.resolutionCode = String(input.resolutionCode);
  }
  if (input.resolutionSummary) {
    body.resolutionSummary = String(input.resolutionSummary);
  }

  const response: any = await apiPost(
    `/api/soko/admin/protection/cases/${encodeURIComponent(caseId)}/action`,
    body,
    { headers: getKristoHeaders() as any }
  );
  assertOk(response, "Could not apply admin protection action.");
  return mapCase(response.case || {});
}
