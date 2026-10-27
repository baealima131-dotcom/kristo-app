import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { buildKristoRequestHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";

/**
 * Client for /api/offline-activation/program/*. The server decides every
 * permission (signed session token only); these helpers just call and unwrap.
 */

export type OnboardingStatus =
  | "invited"
  | "registered"
  | "training_pending"
  | "awaiting_confirmation"
  | "confirmed"
  | "needs_help"
  | "rejected";

export type FollowUpStatus = "none" | "scheduled" | "in_progress" | "completed";

export type OnboardingSummary = {
  churches: number;
  byStatus: Record<OnboardingStatus, number>;
  confirmedInRange: number;
};

export type ProgramChurch = {
  id: string;
  churchId: string | null;
  leaderKristoId: string;
  status: OnboardingStatus;
  registeredAt: string | null;
  agentReport: {
    trainingTopics: string[];
    trainingNotes: string;
    trainingCompleted: boolean;
    followUpStatus: FollowUpStatus;
    followUpNote: string;
    submittedAt: string;
    version: number;
  } | null;
  leaderConfirmation: {
    status: "pending" | "confirmed" | "rejected" | "needs_help";
    requestedAt: string;
    respondedAt: string | null;
    note: string | null;
  } | null;
  confirmationRounds: number;
  createdAt: string;
  updatedAt: string;
};

export type ProgramAgent = {
  userId: string;
  registrationId: string;
  name: string;
  kristoId: string;
  churchId: string;
  registrationStatus: string;
  accessStatus: string;
  hasAgentRole: boolean;
  joinedAt: string;
  onboardings: OnboardingSummary;
  lastActivityAt: string | null;
};

export type ProgramInviteCode = {
  id: string;
  codePreview: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
  state: "active" | "expired" | "revoked" | "used_up";
};

export type SupervisorTeam = {
  supervisorUserId: string;
  accessStatus: string;
  agentLimit: number;
  agentSlotsUsed: number;
  agents: ProgramAgent[];
  onboardings: OnboardingSummary;
  inviteCodes: ProgramInviteCode[];
};

export type AgentWork = {
  agentUserId: string;
  supervisor: { userId: string; name: string; kristoId: string };
  summary: OnboardingSummary;
  churches: ProgramChurch[];
};

export type LeaderConfirmationRequest = {
  requestId: string;
  onboardingId: string;
  question: string;
  requestedAt: string;
  churchId: string;
  agent: { name: string; kristoId: string };
  report: {
    trainingTopics: string[];
    trainingNotes: string;
    followUpStatus: FollowUpStatus;
    followUpNote: string;
    submittedAt: string;
  };
};

export type ProgramCards = {
  supervisor: boolean;
  agent: boolean;
  leaderConfirmations: number;
  canJoinAsAgent: boolean;
  labAdminSignIn: boolean;
  /** False when the server has no program API (older backend): keep the legacy cards. */
  available: boolean;
};

export const NO_PROGRAM_CARDS: ProgramCards = {
  supervisor: false,
  agent: false,
  leaderConfirmations: 0,
  canJoinAsAgent: false,
  labAdminSignIn: false,
  available: false,
};

const BASE = "/api/offline-activation/program";

function headers(path: string) {
  const session = getSessionSync() as any;
  return buildKristoRequestHeaders(
    path,
    {
      userId: String(session?.userId || "").trim(),
      role: String(session?.role || session?.churchRole || "Member").trim() as any,
      churchId: String(session?.churchId || session?.activeChurchId || "").trim(),
      sessionToken: String(session?.sessionToken || "").trim(),
    },
    { accept: "application/json", "content-type": "application/json" },
    "offlineActivationProgramApi"
  );
}

function unwrap<T>(res: any): T {
  if (!res || res.ok === false) throw new Error(String(res?.error || "Request failed"));
  return res as T;
}

async function get<T>(path: string): Promise<T> {
  const full = `${BASE}${path}`;
  return unwrap<T>(await apiGet(full, { headers: headers(full) }, { screen: "UvumbuziProgram", dedupe: false }));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const full = `${BASE}${path}`;
  return unwrap<T>(await apiPost(full, body, { headers: headers(full) }));
}

/** More tab visibility. Any failure (offline, older server) hides the cards. */
export async function fetchProgramCards(): Promise<ProgramCards> {
  try {
    return { ...NO_PROGRAM_CARDS, ...(await get<{ cards: Partial<ProgramCards> }>("/me")).cards, available: true };
  } catch {
    return NO_PROGRAM_CARDS;
  }
}

export const fetchSupervisorTeam = async () => (await get<{ team: SupervisorTeam }>("/supervisor")).team;
export const createInviteCode = (maxUses: number, expiresInHours: number) =>
  post<{ code: string; invite: ProgramInviteCode }>("/supervisor/invite-codes", { maxUses, expiresInHours });
export const revokeInviteCode = (codeId: string) =>
  post<{ invite: ProgramInviteCode }>("/supervisor/invite-codes/revoke", { codeId });
export const fetchSupervisorAgent = (userId: string) =>
  get<{ agent: ProgramAgent; churches: ProgramChurch[] }>(`/supervisor/agents?userId=${encodeURIComponent(userId)}`);

export const redeemAgentCode = (code: string) =>
  post<{ supervisorUserId: string; platformRole: "Agent" }>("/agent/redeem", { code });
export const fetchAgentWork = async () => (await get<{ work: AgentWork }>("/agent")).work;
export const saveChurchOnboarding = (leaderKristoId: string, churchId?: string) =>
  post<{ created: boolean; onboarding: ProgramChurch }>("/agent/onboardings", {
    leaderKristoId,
    churchId: churchId || undefined,
  });
export const submitTrainingReport = (input: {
  onboardingId: string;
  churchId?: string;
  trainingTopics: string[];
  trainingNotes: string;
  trainingCompleted: boolean;
  followUpStatus: FollowUpStatus;
  followUpNote: string;
}) =>
  post<{ onboarding: ProgramChurch; confirmationRequested: boolean; duplicate: boolean }>(
    "/agent/onboardings/report",
    input
  );

export const fetchLeaderConfirmations = async () =>
  (await get<{ requests: LeaderConfirmationRequest[] }>("/leader/confirmations")).requests;
export const respondLeaderConfirmation = (requestId: string, response: "confirm" | "reject" | "needs_help", note: string) =>
  post<{ status: OnboardingStatus; duplicate: boolean }>("/leader/confirmations/respond", { requestId, response, note });

/** System Admin only (checked on the server): one-time Lab sign-in code. */
export async function createLabAdminSignInCode(): Promise<{ code: string; expiresAt: string; labAdminUrl?: string | null }> {
  const path = "/api/uvumbuzi/admin/login-code";
  return unwrap(await apiPost(path, {}, { headers: headers(path) }));
}
