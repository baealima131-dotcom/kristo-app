import {
  fetchMyOfflineActivationInvitations,
  respondToOfflineActivationInvitation,
  type OfflineActivationInvitation,
} from "@/src/lib/offlineActivationInvitationsApi";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import type { KristoSession } from "@/src/lib/kristoSessionTypes";

export const OFFLINE_SUPERVISOR_INVITE_KIND = "offline_supervisor" as const;

export type OfflineSupervisorProfileInvite = {
  kind: typeof OFFLINE_SUPERVISOR_INVITE_KIND;
  id: string;
  invitationId: string;
  churchId: string;
  role: "Supervisor";
  title: string;
  message: string;
  status: "pending";
};

export function isOfflineSupervisorProfileInvite(inv: unknown): inv is OfflineSupervisorProfileInvite {
  return String((inv as any)?.kind || "").trim() === OFFLINE_SUPERVISOR_INVITE_KIND;
}

export function mapOfflineSupervisorInviteForProfile(
  inv: OfflineActivationInvitation
): OfflineSupervisorProfileInvite {
  return {
    kind: OFFLINE_SUPERVISOR_INVITE_KIND,
    id: inv.id,
    invitationId: inv.id,
    churchId: inv.churchId,
    role: "Supervisor",
    title: "Supervisor invitation",
    message: `You were invited to manage activation codes for ${inv.churchId}`,
    status: "pending",
  };
}

export async function loadOfflineSupervisorProfileInvites(): Promise<OfflineSupervisorProfileInvite[]> {
  const rows = await fetchMyOfflineActivationInvitations();
  return rows
    .filter((row) => row.role === "Supervisor" && row.status === "pending")
    .map(mapOfflineSupervisorInviteForProfile);
}

export async function respondOfflineSupervisorProfileInvite(input: {
  session: KristoSession;
  invitationId: string;
  action: "accept" | "decline";
  setSession: (session: KristoSession) => Promise<void>;
}) {
  const result = await respondToOfflineActivationInvitation({
    invitationId: input.invitationId,
    action: input.action,
  });

  if (input.action === "accept" && result.platformRole) {
    const next = {
      ...input.session,
      platformRole: result.platformRole,
      offlineActivationRole: result.offlineActivationRole || result.platformRole,
    };
    await input.setSession(next);
    console.log("KRISTO_SUPERVISOR_INVITE_ACCEPTED_SESSION_SYNC", {
      userId: input.session.userId,
      platformRole: result.platformRole,
    });
  }

  clearResponseCacheForRequest("GET", "/api/auth/profile", input.session.userId);
  clearResponseCacheForRequest("GET", "/api/offline-activation/invitations", input.session.userId);

  console.log("KRISTO_INVITATIONS_OFFLINE_SUPERVISOR_RESPOND_SUCCESS", {
    userId: input.session.userId,
    invitationId: input.invitationId,
    action: input.action,
    platformRole: result.platformRole,
  });

  return result;
}
