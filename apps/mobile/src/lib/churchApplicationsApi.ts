import { apiDelete, apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

/** Client for the church application workflow (/api/church/applications). */

export type ChurchApplicationStatus =
  | "pending_review"
  | "more_info_needed"
  | "conditionally_approved"
  | "requirements_in_progress"
  | "ready_for_admin_review"
  | "active"
  | "rejected"
  | "expired";

export const CHURCH_APPLICATION_STATUS_LABELS: Record<ChurchApplicationStatus, string> = {
  pending_review: "Pending Review",
  more_info_needed: "More Information Needed",
  conditionally_approved: "Conditionally Approved",
  requirements_in_progress: "Requirements In Progress",
  ready_for_admin_review: "Ready for Admin Review",
  active: "Active",
  rejected: "Rejected",
  expired: "Expired",
};

export const CHURCH_APPLICATION_STATUS_COLORS: Record<ChurchApplicationStatus, string> = {
  pending_review: "#F4D06F",
  more_info_needed: "#FDBA74",
  conditionally_approved: "#93C5FD",
  requirements_in_progress: "#93C5FD",
  ready_for_admin_review: "#C4B5FD",
  active: "#86EFAC",
  rejected: "#FB7185",
  expired: "#FB7185",
};

export type ApplicationChurchInfo = {
  name: string;
  phone: string;
  country: string;
  province: string;
  city: string;
  address?: string;
  description?: string;
};

export type ApplicantRequirement = {
  id: string;
  kind: "verified_members" | "manual";
  title: string;
  description?: string;
  target?: number;
  current?: number;
  deadlineAt: string;
  completed: boolean;
  completedAt?: string;
};

export type ApplicantApplication = {
  id: string;
  status: ChurchApplicationStatus;
  statusLabel: string;
  church: ApplicationChurchInfo;
  churchId?: string;
  source: "direct" | "agent";
  agentName?: string;
  submittedAt: string;
  updatedAt: string;
  activationMode: "auto" | "admin_review";
  adminMessage?: string;
  adminMessageAt?: string;
  unseenUpdate: boolean;
  requirements: ApplicantRequirement[];
  timeline: { at: string; type: string; status?: ChurchApplicationStatus; statusLabel?: string; message?: string }[];
};

export type PendingChurchForMember = {
  churchId: string;
  churchName: string;
  activationStatus: string;
  applicationStatus?: ChurchApplicationStatus;
  requirements: { title: string; kind: string; target?: number; current?: number; deadlineAt: string; completed: boolean }[];
};

export type AdminRequirement = {
  id: string;
  kind: "verified_members" | "manual";
  title: string;
  description?: string;
  target?: number;
  deadlineAt: string;
  templateId?: string;
  current?: number;
  completedAt?: string;
  completedBy?: string;
};

export type AdminApplication = {
  id: string;
  status: ChurchApplicationStatus;
  statusLabel: string;
  needsReview: boolean;
  church: ApplicationChurchInfo;
  applicantUserId: string;
  applicantName: string;
  applicantKristoId?: string;
  source: "direct" | "agent";
  agent?: {
    agentUserId: string;
    agentRegistrationId: string;
    agentName: string;
    agentKristoId: string;
    agentCode: string;
    submittedAt: string;
    codeRedeemedAt?: string;
    codeRedeemError?: string;
  };
  submittedAt: string;
  updatedAt: string;
  churchId?: string;
  activationMode: "auto" | "admin_review";
  approvalType?: "with_requirements" | "without_requirements";
  requirements: AdminRequirement[];
  adminMessage?: string;
  applicantResponse?: string;
  history: {
    at: string;
    type: string;
    byUserId: string;
    byRole: string;
    fromStatus?: ChurchApplicationStatus;
    toStatus?: ChurchApplicationStatus;
    message?: string;
    details?: Record<string, unknown>;
  }[];
};

export type RequirementTemplate = {
  id: string;
  kind: "verified_members" | "manual";
  title: string;
  description?: string;
  target?: number;
  durationDays: number;
  builtin?: boolean;
};

export type RequirementInput = {
  id?: string;
  templateId?: string;
  kind: "verified_members" | "manual";
  title: string;
  target?: number;
  deadlineAt?: string;
  durationDays?: number;
  description?: string;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message: string };

function headers() {
  return getKristoHeaders() as any;
}

function fail(res: any): { ok: false; error: string; message: string } {
  return {
    ok: false,
    error: String(res?.error || "request_failed"),
    message: String(res?.message || res?.error || "Request failed"),
  };
}

export async function submitChurchApplication(
  body: ApplicationChurchInfo & { source?: "direct" | "agent"; leaderKristoId?: string; agentCode?: string }
): Promise<Result<{ id: string; status: ChurchApplicationStatus }>> {
  const res: any = await apiPost("/api/church/applications", body, { headers: headers() });
  if (!res?.ok) return fail(res);
  return { ok: true, data: res.application };
}

export async function fetchMyChurchApplication(opts: { markSeen?: boolean } = {}): Promise<
  Result<{ application: ApplicantApplication | null; pendingChurch: PendingChurchForMember | null }>
> {
  const res: any = await apiGet(
    `/api/church/applications/mine${opts.markSeen ? "?seen=1" : ""}`,
    { headers: headers() },
    { screen: "ChurchApplicationMine", throttleMs: 0, dedupe: false }
  );
  if (!res?.ok) return fail(res);
  return { ok: true, data: { application: res.application || null, pendingChurch: res.pendingChurch || null } };
}

export async function respondToChurchApplication(
  applicationId: string,
  response: string,
  church?: Partial<ApplicationChurchInfo>
): Promise<Result<ApplicantApplication>> {
  const res: any = await apiPatch("/api/church/applications/mine", { applicationId, response, church }, { headers: headers() });
  if (!res?.ok) return fail(res);
  return { ok: true, data: res.application };
}

export async function fetchAdminChurchApplications(filter: { status?: string; source?: string; q?: string } = {}): Promise<
  Result<{ applications: AdminApplication[]; counts: Record<string, number>; sourceCounts: { direct: number; agent: number } }>
> {
  const sp = new URLSearchParams();
  if (filter.status && filter.status !== "all") sp.set("status", filter.status);
  if (filter.source && filter.source !== "all") sp.set("source", filter.source);
  if (filter.q?.trim()) sp.set("q", filter.q.trim());
  const res: any = await apiGet(
    `/api/church/applications/admin${sp.toString() ? `?${sp.toString()}` : ""}`,
    { headers: headers() },
    { screen: "ChurchApplicationsAdmin", throttleMs: 0, dedupe: false }
  );
  if (!res?.ok) return fail(res);
  return { ok: true, data: { applications: res.applications || [], counts: res.counts || {}, sourceCounts: res.sourceCounts || { direct: 0, agent: 0 } } };
}

export async function fetchAdminChurchApplication(id: string): Promise<Result<AdminApplication>> {
  const res: any = await apiGet(
    `/api/church/applications/admin/${encodeURIComponent(id)}`,
    { headers: headers() },
    { screen: "ChurchApplicationAdminDetail", throttleMs: 0, dedupe: false }
  );
  if (!res?.ok) return fail(res);
  return { ok: true, data: res.application };
}

export async function adminChurchApplicationAction(
  id: string,
  body: {
    action: string;
    message?: string;
    requirements?: RequirementInput[];
    activationMode?: "auto" | "admin_review";
    requirementId?: string;
    deadlineAt?: string;
    expectedUpdatedAt?: string;
    /** approve: create and activate the church now, with no requirements. */
    withoutRequirements?: boolean;
  }
): Promise<Result<AdminApplication>> {
  const res: any = await apiPost(`/api/church/applications/admin/${encodeURIComponent(id)}`, body, { headers: headers() });
  if (!res?.ok) return fail(res);
  return { ok: true, data: res.application };
}

export async function fetchRequirementTemplates(): Promise<Result<RequirementTemplate[]>> {
  const res: any = await apiGet(
    "/api/church/applications/admin/templates",
    { headers: headers() },
    { screen: "ChurchRequirementTemplates", throttleMs: 0, dedupe: false }
  );
  if (!res?.ok) return fail(res);
  return { ok: true, data: res.templates || [] };
}

export async function createRequirementTemplate(body: {
  kind: "verified_members" | "manual";
  title: string;
  target?: number;
  durationDays: number;
  description?: string;
}): Promise<Result<RequirementTemplate>> {
  const res: any = await apiPost("/api/church/applications/admin/templates", body, { headers: headers() });
  if (!res?.ok) return fail(res);
  return { ok: true, data: res.template };
}

export async function deleteRequirementTemplate(id: string): Promise<Result<true>> {
  const res: any = await apiDelete(`/api/church/applications/admin/templates?id=${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  if (!res?.ok) return fail(res);
  return { ok: true, data: true };
}

export function isDeadlinePassed(deadlineAt: string, nowMs = Date.now()) {
  return Date.parse(deadlineAt) < nowMs;
}

/** "12 days left", "Due today", "3 days overdue". */
export function formatTimeRemaining(deadlineAt: string, nowMs = Date.now()) {
  const ms = Date.parse(deadlineAt) - nowMs;
  if (!Number.isFinite(ms)) return "";
  const days = Math.ceil(Math.abs(ms) / 86400000);
  if (ms < 0) return days <= 1 ? "Overdue" : `${days} days overdue`;
  if (ms < 86400000) return "Due today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

export function formatShortDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
