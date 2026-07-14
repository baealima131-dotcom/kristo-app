import {
  resolveAgentRegistrationByKristoAndChurch,
} from "@/app/api/_lib/offlineActivationAdmin";

import {
  dbCreateSafetyInvite,
  dbFindPendingSafetyInvite,
  dbHasSafetyRole,
} from "@/app/api/_lib/store/safetyDb";

export async function inviteSafetySupervisor(
  kristoId: string,
  churchId: string,
  invitedByUserId: string
) {
  const user =
    await resolveAgentRegistrationByKristoAndChurch(
      kristoId,
      churchId
    );

  const alreadySupervisor =
    await dbHasSafetyRole(
      user.userId,
      "Safety_Supervisor"
    );

  if (alreadySupervisor) {
    return {
      outcome:
        "alreadySupervisor" as const,
      user,
      invitation: null,
    };
  }

  const pending =
    await dbFindPendingSafetyInvite({
      inviteeUserId: user.userId,
      churchId: user.churchId,
      role: "Safety_Supervisor",
    });

  if (pending) {
    return {
      outcome: "alreadyPending" as const,
      user,
      invitation: pending,
    };
  }

  const invitation =
    await dbCreateSafetyInvite({
      inviteeUserId: user.userId,
      inviteeKristoId: user.kristoId,
      churchId: user.churchId,
      invitedByUserId:
        String(
          invitedByUserId || ""
        ).trim(),
      role: "Safety_Supervisor",
    });

  return {
    outcome: "invited" as const,
    user,
    invitation,
  };
}
