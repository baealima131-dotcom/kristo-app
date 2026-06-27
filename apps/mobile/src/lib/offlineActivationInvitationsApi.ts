import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { buildKristoRequestHeaders } from "@/src/lib/kristoHeaders";
import type { PlatformRole } from "@/src/lib/kristoSessionTypes";

export type OfflineActivationInvitation = {
  id: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
  role: "Supervisor";
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  respondedAt?: string | null;
};

export type RespondInvitationResult = {
  invitation: OfflineActivationInvitation;
  platformRole: PlatformRole | null;
  offlineActivationRole: PlatformRole | null;
};

function buildInvitationRequestHeaders(path: string) {
  return buildKristoRequestHeaders(path);
}

export async function fetchMyOfflineActivationInvitations(): Promise<OfflineActivationInvitation[]> {
  const path = "/api/offline-activation/invitations";
  console.log("KRISTO_SUPERVISOR_INVITES_LOAD");

  const res = await apiGet<
    { ok: true; invitations: OfflineActivationInvitation[] } | { ok: false; error: string }
  >(path, { headers: buildInvitationRequestHeaders(path) }, { screen: "offline-activation-invitations" });

  if (!res || (res as any).ok === false) {
    throw new Error(String((res as any)?.error || "Failed to load invitations"));
  }

  return Array.isArray((res as any).invitations) ? (res as any).invitations : [];
}

export async function respondToOfflineActivationInvitation(input: {
  invitationId: string;
  action: "accept" | "decline";
}): Promise<RespondInvitationResult> {
  const path = "/api/offline-activation/invitations/respond";
  const invitationId = String(input.invitationId || "").trim();
  const action = input.action;

  console.log("KRISTO_SUPERVISOR_INVITE_RESPOND_START", { invitationId, action });

  try {
    const res = await apiPost<
      | {
          ok: true;
          invitation: OfflineActivationInvitation;
          platformRole?: PlatformRole | null;
          offlineActivationRole?: PlatformRole | null;
        }
      | { ok: false; error: string }
    >(path, { invitationId, action }, { headers: buildInvitationRequestHeaders(path) });

    if (!res || (res as any).ok === false) {
      throw new Error(String((res as any)?.error || "Failed to respond to invitation"));
    }

    const platformRole = ((res as any).platformRole || null) as PlatformRole | null;
    const offlineActivationRole = ((res as any).offlineActivationRole || platformRole || null) as
      | PlatformRole
      | null;

    console.log("KRISTO_SUPERVISOR_INVITE_RESPOND_SUCCESS", {
      invitationId,
      action,
      status: (res as any).invitation?.status || null,
      platformRole,
    });

    return {
      invitation: (res as any).invitation,
      platformRole,
      offlineActivationRole,
    };
  } catch (error: any) {
    console.warn("KRISTO_SUPERVISOR_INVITE_RESPOND_FAILED", {
      invitationId,
      action,
      error: String(error?.message || error),
    });
    throw error;
  }
}
