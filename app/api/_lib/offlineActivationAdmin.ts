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
  type OfflineActivationInvitation,
} from "@/app/api/_lib/offlineActivationInvitations";
import {
  createSupervisorAgent,
  findSupervisorAgentByLinkedUser,
  isAcceptedAgentStatus,
} from "@/app/api/_lib/offlineActivationAgentStore";

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

export async function inviteAgentByKristoAndChurch(
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
