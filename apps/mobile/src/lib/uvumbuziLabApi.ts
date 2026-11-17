/**
 * UVUMBUZI Lab inside Kristo.
 *
 * Every call goes to the Kristo server (/api/uvumbuzi/lab/...) with the normal
 * signed Kristo session; Kristo relays it to the Lab. The phone never holds a
 * Lab token or the Lab address, and has no separate Lab account.
 */
import { apiGet, apiPost } from "./kristoApi";

export type LabRole = "owner" | "leader" | "member";
export type LabTaskStatus = "assigned" | "submitted" | "approved" | "changes_requested";
export type LabProposalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export type LabProjectSummary = { id: string; name: string; description: string; role: LabRole };
export type LabReport = { id: string; authorSubject: string; note: string; evidenceUrl: string | null; createdAt: string };
export type LabDecision = { id: string; reportId: string; reviewerSubject: string; decision: "approved" | "changes_requested"; reason: string; createdAt: string };
export type LabTask = {
  id: string;
  title: string;
  details: string;
  assigneeSubject: string;
  createdBy: string;
  status: LabTaskStatus;
  createdAt: string;
  updatedAt: string;
  reports: LabReport[];
  decisions: LabDecision[];
};
export type LabProposal = {
  id: string;
  proposerSubject: string;
  title: string;
  summary: string;
  workspaceId: string | null;
  baseRevision: number | null;
  status: LabProposalStatus;
  decidedBy: string | null;
  decisionReason: string;
  createdAt: string;
  decidedAt: string | null;
};
export type LabActivity = { seq: number; actorSubject: string; action: string; targetType: string; targetId: string; detail: string; createdAt: string };
export type LabMember = { subject: string; role: "leader" | "member"; invitedBy: string; createdAt: string };
/** Added by the Kristo server: internal user id -> public Kristo ID (never names or contact details). */
export type LabPeople = Record<string, { kristoId: string }>;
export type LabProjectHistory = {
  role: LabRole;
  projectId: string;
  ownerSubject: string;
  /** Present for owner and leaders only. */
  members?: LabMember[];
  tasks: LabTask[];
  proposals: LabProposal[];
  activity: LabActivity[];
  people?: LabPeople;
};

export type LabError = { ok: false; error: string; status?: number; reason?: string };
export type LabResult<T> = { ok: true; data: T } | LabError;

const BASE = "/api/uvumbuzi/lab";

function unwrap<T>(res: any): LabResult<T> {
  if (res && typeof res === "object" && !Array.isArray(res) && res.ok === false) {
    return { ok: false, error: String(res.error || "Request failed"), status: res.status, reason: res.reason };
  }
  return { ok: true, data: res as T };
}

const seg = (id: string) => encodeURIComponent(id);
const get = async <T>(path: string) => unwrap<T>(await apiGet<any>(`${BASE}/${path}`, undefined, { screen: "UvumbuziLab", dedupe: false }));
const post = async <T>(path: string, body: Record<string, unknown> = {}) => unwrap<T>(await apiPost<any>(`${BASE}/${path}`, body));

/** The Lab is not connected on this Kristo server yet (503) — show a calm "coming soon" state, not an error. */
export function isLabNotConnected(r: LabResult<unknown>): boolean {
  return !r.ok && (r.status === 503 || r.reason === "lab_not_configured");
}

export const uvumbuziLab = {
  me: () => get<{ subject: string; kristoId?: string | null; people?: LabPeople; projects: LabProjectSummary[] }>("me"),
  createProject: (name: string, description: string) =>
    post<{ id: string; name: string; role: LabRole }>("projects", { name, description }),
  history: (projectId: string) => get<LabProjectHistory>(`projects/${seg(projectId)}/history`),
  /** Invite by public Kristo ID (e.g. KR7-12345AB); the Kristo server resolves it. */
  addMember: (projectId: string, kristoId: string) => post(`projects/${seg(projectId)}/members`, { kristoId }),
  setRole: (projectId: string, subject: string, role: "leader" | "member") =>
    post(`projects/${seg(projectId)}/members/${seg(subject)}/role`, { role }),
  createTask: (projectId: string, title: string, details: string, assigneeSubject: string) =>
    post(`projects/${seg(projectId)}/tasks`, { title, details, assigneeSubject }),
  submitReport: (taskId: string, note: string, evidenceUrl?: string) =>
    post(`tasks/${seg(taskId)}/reports`, evidenceUrl ? { note, evidenceUrl } : { note }),
  reviewTask: (taskId: string, decision: "approved" | "changes_requested", reason: string) =>
    post(`tasks/${seg(taskId)}/decision`, { decision, reason }),
  propose: (projectId: string, title: string, summary: string) =>
    post(`projects/${seg(projectId)}/proposals`, { title, summary }),
  decideProposal: (proposalId: string, decision: "approved" | "rejected", reason: string) =>
    post(`proposals/${seg(proposalId)}/decision`, { decision, reason }),
  withdrawProposal: (proposalId: string) => post(`proposals/${seg(proposalId)}/withdraw`),
};
