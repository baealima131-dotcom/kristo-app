import {
  apiGet,
  apiPatch,
  apiPost,
} from "@/src/lib/kristoApi";
import {
  getKristoHeaders,
} from "@/src/lib/kristoHeaders";

export type SokoSellerApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";

export type SokoSellerApplication = {
  id: string;
  userId: string;
  kristoId: string;
  displayName: string;
  email?: string;
  phone?: string;
  businessName: string;
  category: string;
  location: string;
  reason: string;
  status: SokoSellerApplicationStatus;
  adminNotes?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  commandCode?: string;
  codeExpiresAt?: string;
};

function assertOk(
  response: any,
  fallback: string
) {
  if (!response || response.ok === false) {
    throw new Error(
      String(
        response?.error || fallback
      )
    );
  }

  return response;
}

export async function fetchMySokoSellerApplication() {
  const response: any =
    await apiGet(
      "/api/soko/seller/application",
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  assertOk(
    response,
    "Could not load your seller application."
  );

  return (
    response.application || null
  ) as SokoSellerApplication | null;
}

export async function submitMySokoSellerApplication(
  input: {
    businessName: string;
    category: string;
    location: string;
    reason: string;
  }
) {
  const response: any =
    await apiPost(
      "/api/soko/seller/application",
      input,
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  assertOk(
    response,
    "Could not submit seller application."
  );

  return response.application as
    SokoSellerApplication;
}

export async function fetchSokoSellerApplications(
  status = ""
) {
  const query = status
    ? `?status=${encodeURIComponent(status)}`
    : "";
  const response: any =
    await apiGet(
      `/api/soko/system-admin/seller-applications${query}`,
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  assertOk(
    response,
    "Could not load seller applications."
  );

  return Array.isArray(
    response.applications
  )
    ? (response.applications as
        SokoSellerApplication[])
    : [];
}

export async function reviewSokoSellerApplication(
  input: {
    applicationId: string;
    decision:
      | "approve"
      | "reject"
      | "revoke"
      | "regenerate_code";
    notes?: string;
  }
) {
  const response: any =
    await apiPatch(
      "/api/soko/system-admin/seller-applications",
      input,
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  assertOk(
    response,
    "Could not review seller application."
  );

  return response.application as
    SokoSellerApplication;
}
