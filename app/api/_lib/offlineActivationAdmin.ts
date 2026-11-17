import { getUserById } from "@/app/api/auth/_lib/session";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  getMembershipsForUser,
  normalizeMembershipChurchId,
} from "@/app/api/_lib/memberships";
import { getPlatformRole } from "@/app/api/_lib/platformRoles";
import {
  createSupervisorInvitation,
  createAgentInvitation,
  findPendingSupervisorInvitation,
  findPendingAgentInvitation,
  getInvitationById,
  type OfflineActivationInvitation,
} from "@/app/api/_lib/offlineActivationInvitations";
import {
  createSupervisorAgent,
  findSupervisorAgentByLinkedUser,
  isAcceptedAgentStatus,
} from "@/app/api/_lib/offlineActivationAgentStore";
import { appendOfflineActivationAudit } from "@/app/api/_lib/offlineActivationAudit";
import {
  assertSupervisorCanInviteAgent,
  DEFAULT_SUPERVISOR_AGENT_LIMIT,
  PROGRAM_LOCK,
  ProgramError,
} from "@/app/api/_lib/offlineActivationProgram";
import {
  callProgramFunction,
  ProgramDbError,
  useProgramPostgres,
} from "@/app/api/_lib/store/offlineActivationProgramDb";
import { withOfflineActivationLock } from "@/app/api/_lib/store/offlineActivationDb";

export type ActivationUserRef = {
  userId: string;
  kristoId: string;
  churchId: string;
  fullName?: string;
};

const KRISTO_ID_PATTERN = /^KR7-[A-Z0-9]{6,10}$/;

export function normalizeKristoIdInput(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function isValidKristoId(value: unknown): boolean {
  return KRISTO_ID_PATTERN.test(normalizeKristoIdInput(value));
}

export async function resolveUserByKristoId(kristoId: string): Promise<{
  userId: string;
  kristoId: string;
  fullName?: string;
}> {
  const normalizedKristoId = normalizeKristoIdInput(kristoId);
  if (!normalizedKristoId) {
    throw new Error("KRISTO ID is required");
  }
  if (!isValidKristoId(normalizedKristoId)) {
    throw new Error("Invalid KRISTO ID format");
  }

  const profile = await getProfileByUserCode(normalizedKristoId);
  const userId = String(profile?.userId || "").trim();
  if (!profile || !userId) {
    throw new Error("KRISTO ID not found");
  }

  const user = await getUserById(userId);
  if (!user) {
    throw new Error("KRISTO ID not found");
  }

  return {
    userId,
    kristoId: String(profile.userCode || normalizedKristoId).trim().toUpperCase(),
    fullName: String(profile.fullName || "").trim() || undefined,
  };
}

export type InviteSupervisorOutcome = "invited" | "alreadyPending" | "alreadySupervisor";

export type InviteAgentOutcome =
  | "invited"
  | "alreadyPending"
  | "alreadyAgent"
  | "alreadyAccepted";

export type InviteAgentResult = {
  outcome: InviteAgentOutcome;
  user: ActivationUserRef;
  invitation?: OfflineActivationInvitation;
  agent?: Awaited<ReturnType<typeof createSupervisorAgent>>;
};

export type InviteSupervisorResult = {
  outcome: InviteSupervisorOutcome;
  user: ActivationUserRef;
  invitation?: OfflineActivationInvitation;
};

export async function resolveAgentRegistrationByKristoAndChurch(
  kristoId: string,
  churchId: string
): Promise<ActivationUserRef & { phone?: string; avatarUrl?: string }> {
  const normalizedChurchId = normalizeMembershipChurchId(churchId);
  if (!normalizedChurchId) {
    throw new Error("Church ID is required");
  }

  const resolved = await resolveUserByKristoId(kristoId);

  const church = await getChurchById(normalizedChurchId);
  if (!church) {
    throw new Error("Church ID not found");
  }

  const memberships = await getMembershipsForUser(resolved.userId);
  const activeAtChurch = memberships.find(
    (membership) =>
      membership.status === "Active" &&
      normalizeMembershipChurchId(membership.churchId) === normalizedChurchId
  );
  if (!activeAtChurch) {
    throw new Error("User is not an Active member of this church");
  }

  const profile = await getProfile(resolved.userId);

  return {
    userId: resolved.userId,
    kristoId: resolved.kristoId,
    churchId: normalizedChurchId,
    fullName: resolved.fullName || String(profile?.fullName || "").trim() || undefined,
    phone: String(profile?.phone || "").trim() || undefined,
    avatarUrl: String(profile?.avatarUrl || "").trim() || undefined,
  };
}

export async function inviteSupervisorByKristoAndChurch(
  kristoId: string,
  churchId: string,
  addedByUserId: string
): Promise<InviteSupervisorResult> {
  const normalizedChurchId = normalizeMembershipChurchId(churchId);
  if (!normalizedChurchId) {
    throw new Error("Church ID is required");
  }

  const resolved = await resolveUserByKristoId(kristoId);

  const church = await getChurchById(normalizedChurchId);
  if (!church) {
    throw new Error("Church ID not found");
  }

  const memberships = await getMembershipsForUser(resolved.userId);
  const activeAtChurch = memberships.find(
    (membership) =>
      membership.status === "Active" &&
      normalizeMembershipChurchId(membership.churchId) === normalizedChurchId
  );
  if (!activeAtChurch) {
    throw new Error("User is not an Active member of this church");
  }

  const existing = await getPlatformRole(resolved.userId);
  if (existing === "System_Admin") {
    throw new Error("User is already System_Admin");
  }
  if (existing === "Supervisor") {
    return {
      outcome: "alreadySupervisor",
      user: {
        userId: resolved.userId,
        kristoId: resolved.kristoId,
        churchId: normalizedChurchId,
        fullName: resolved.fullName,
      },
    };
  }
  if (existing === "Agent") {
    throw new Error("User is already an Agent");
  }

  const pending = await findPendingSupervisorInvitation({
    inviteeUserId: resolved.userId,
    churchId: normalizedChurchId,
  });
  if (pending) {
    return {
      outcome: "alreadyPending",
      user: {
        userId: resolved.userId,
        kristoId: resolved.kristoId,
        churchId: normalizedChurchId,
        fullName: resolved.fullName,
      },
      invitation: pending,
    };
  }

  const invitation = await createSupervisorInvitation({
    inviteeUserId: resolved.userId,
    inviteeKristoId: resolved.kristoId,
    churchId: normalizedChurchId,
    invitedByUserId: String(addedByUserId || "").trim() || "unknown",
  });

  return {
    outcome: "invited",
    user: {
      userId: resolved.userId,
      kristoId: resolved.kristoId,
      churchId: normalizedChurchId,
      fullName: resolved.fullName,
    },
    invitation,
  };
}

async function inviteAgentByKristoAndChurchUnlocked(
  kristoId: string,
  churchId: string,
  supervisorUserId: string
): Promise<InviteAgentResult> {
  const resolved = await resolveAgentRegistrationByKristoAndChurch(kristoId, churchId);
  const normalizedChurchId = resolved.churchId;

  const existingRole = await getPlatformRole(resolved.userId);
  if (existingRole === "System_Admin") {
    throw new Error("User is already System_Admin");
  }
  if (existingRole === "Supervisor") {
    throw new Error("User is already a Supervisor");
  }

  const existingAgent = await findSupervisorAgentByLinkedUser(
    supervisorUserId,
    resolved.userId,
    normalizedChurchId
  );
  if (existingAgent) {
    if (existingAgent.status === "pending") {
      const pendingInvite = await findPendingAgentInvitation({
        inviteeUserId: resolved.userId,
        churchId: normalizedChurchId,
        invitedByUserId: supervisorUserId,
      });
      return {
        outcome: "alreadyPending",
        user: {
          userId: resolved.userId,
          kristoId: resolved.kristoId,
          churchId: normalizedChurchId,
          fullName: resolved.fullName,
        },
        invitation: pendingInvite || undefined,
        agent: existingAgent,
      };
    }
    if (isAcceptedAgentStatus(existingAgent.status)) {
      return {
        outcome: existingRole === "Agent" ? "alreadyAgent" : "alreadyAccepted",
        user: {
          userId: resolved.userId,
          kristoId: resolved.kristoId,
          churchId: normalizedChurchId,
          fullName: resolved.fullName,
        },
        agent: existingAgent,
      };
    }
    if (existingAgent.status === "declined") {
      throw new Error("User previously declined this agent invitation");
    }
    if (existingAgent.status === "inactive") {
      return {
        outcome: "alreadyAccepted",
        user: {
          userId: resolved.userId,
          kristoId: resolved.kristoId,
          churchId: normalizedChurchId,
          fullName: resolved.fullName,
        },
        agent: existingAgent,
      };
    }
  }

  const pending = await findPendingAgentInvitation({
    inviteeUserId: resolved.userId,
    churchId: normalizedChurchId,
    invitedByUserId: supervisorUserId,
  });
  if (pending) {
    return {
      outcome: "alreadyPending",
      user: {
        userId: resolved.userId,
        kristoId: resolved.kristoId,
        churchId: normalizedChurchId,
        fullName: resolved.fullName,
      },
      invitation: pending,
    };
  }

  if (useProgramPostgres()) {
    // Limit check, invitation, pending registration and audit in one transaction.
    const now = new Date().toISOString();
    const agentRecord = {
      id: `oactagent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      supervisorUserId,
      kristoId: resolved.kristoId,
      churchId: normalizedChurchId,
      fullName: resolved.fullName || resolved.kristoId,
      phone: String(resolved.phone || ""),
      status: "pending",
      ...(resolved.avatarUrl ? { avatarUrl: resolved.avatarUrl } : {}),
      linkedUserId: resolved.userId,
      createdAt: now,
      updatedAt: now,
    };
    let created: { outcome: string; invitationId?: string };
    try {
      created = await callProgramFunction<{ outcome: string; invitationId?: string }>("oact_invite_agent",
        [supervisorUserId, resolved.userId, resolved.kristoId, normalizedChurchId,
          `oactinv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, agentRecord,
          DEFAULT_SUPERVISOR_AGENT_LIMIT],
        ["text", "text", "text", "text", "text", "jsonb", "int"]);
    } catch (error) {
      if (error instanceof ProgramDbError) throw new ProgramError(error.status, error.message);
      throw error;
    }
    const user = {
      userId: resolved.userId,
      kristoId: resolved.kristoId,
      churchId: normalizedChurchId,
      fullName: resolved.fullName,
    };
    if (created.outcome === "exists") {
      // Raced with another request for the same agent: report what is there now.
      const agentNow = await findSupervisorAgentByLinkedUser(supervisorUserId, resolved.userId, normalizedChurchId);
      return { outcome: "alreadyPending", user, agent: agentNow || undefined };
    }
    const invitationNow = created.invitationId ? await getInvitationById(created.invitationId) : null;
    const agentNow = await findSupervisorAgentByLinkedUser(supervisorUserId, resolved.userId, normalizedChurchId);
    return {
      outcome: created.outcome === "invited" ? "invited" : "alreadyPending",
      user,
      invitation: invitationNow || undefined,
      agent: agentNow || undefined,
    };
  }

  await assertSupervisorCanInviteAgent(supervisorUserId);

  const invitation = await createAgentInvitation({
    inviteeUserId: resolved.userId,
    inviteeKristoId: resolved.kristoId,
    churchId: normalizedChurchId,
    invitedByUserId: String(supervisorUserId || "").trim() || "unknown",
  });

  const agent = await createSupervisorAgent({
    supervisorUserId,
    kristoId: resolved.kristoId,
    churchId: normalizedChurchId,
    fullName: resolved.fullName || resolved.kristoId,
    phone: resolved.phone,
    avatarUrl: resolved.avatarUrl,
    linkedUserId: resolved.userId,
    status: "pending",
  });

  await appendOfflineActivationAudit({
    actorUserId: supervisorUserId,
    actorRole: "Supervisor",
    action: "agent.invited",
    targetType: "invitation",
    targetId: invitation.id,
    details: { inviteeUserId: resolved.userId, churchId: normalizedChurchId },
  });

  return {
    outcome: "invited",
    user: {
      userId: resolved.userId,
      kristoId: resolved.kristoId,
      churchId: normalizedChurchId,
      fullName: resolved.fullName,
    },
    invitation,
    agent,
  };
}

/** Limit check and registration happen under the program lock (no over-subscription). */
export const inviteAgentByKristoAndChurch = (
  ...args: Parameters<typeof inviteAgentByKristoAndChurchUnlocked>
) => withOfflineActivationLock(PROGRAM_LOCK, () => inviteAgentByKristoAndChurchUnlocked(...args));
