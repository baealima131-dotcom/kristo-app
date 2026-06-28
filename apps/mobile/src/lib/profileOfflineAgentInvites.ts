import {
  acceptAgentInvitation,
  declineAgentInvitation,
  fetchAgentInvitations,
  type AgentInvitationRecord,
} from "@/src/lib/offlineActivationAgentApi";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import type { KristoSession } from "@/src/lib/kristoSessionTypes";
import type { PlatformRole } from "@/src/lib/kristoSessionTypes";

export const OFFLINE_AGENT_INVITE_KIND = "offline_agent" as const;

export const OFFLINE_AGENT_INVITE_TITLE = "Agent invitation";

export const OFFLINE_AGENT_INVITE_BODY =
  "You were invited to become a Kristo activation agent. Accept to receive assigned codes and activate churches in your network.";

export function buildOfflineAgentReferenceChurchLabel(churchId: string): string {
  const id = String(churchId || "").trim();
  return id ? `Church ID · ${id}` : "Church ID · —";
}

export type OfflineAgentProfileInvite = {
  kind: typeof OFFLINE_AGENT_INVITE_KIND;
  id: string;
  invitationId: string;
  churchId: string;
  role: "Agent";
  title: string;
  message: string;
  referenceChurchLabel: string;
  status: "pending";
  inviteeKristoId?: string;
  invitedByUserId?: string;
  createdAt?: string;
};

export function isOfflineAgentProfileInvite(inv: unknown): inv is OfflineAgentProfileInvite {
  return String((inv as any)?.kind || "").trim() === OFFLINE_AGENT_INVITE_KIND;
}

export function mapOfflineAgentInviteForProfile(inv: AgentInvitationRecord): OfflineAgentProfileInvite {
  return {
    kind: OFFLINE_AGENT_INVITE_KIND,
    id: inv.id,
    invitationId: inv.id,
    churchId: inv.churchId,
    role: "Agent",
    title: OFFLINE_AGENT_INVITE_TITLE,
    message: OFFLINE_AGENT_INVITE_BODY,
    referenceChurchLabel: buildOfflineAgentReferenceChurchLabel(inv.churchId),
    status: "pending",
    inviteeKristoId: inv.inviteeKristoId,
    invitedByUserId: inv.invitedByUserId,
    createdAt: inv.createdAt,
  };
}

export async function loadOfflineAgentProfileInvites(): Promise<OfflineAgentProfileInvite[]> {
  const rows = await fetchAgentInvitations();
  return rows
    .filter((row) => row.role === "Agent" && row.status === "pending")
    .map(mapOfflineAgentInviteForProfile);
}

function clearAgentInviteCaches(userId: string) {
  clearResponseCacheForRequest("GET", "/api/auth/profile", userId);
  clearResponseCacheForRequest("GET", "/api/offline-activation/agent/invitations", userId);
  clearResponseCacheForRequest("GET", "/api/offline-activation/agent/access", userId);
  clearResponseCacheForRequest("GET", "/api/offline-activation/invitations", userId);
}

export async function respondOfflineAgentProfileInvite(input: {
  session: KristoSession;
  invitationId: string;
  action: "accept" | "decline";
  setSession: (session: KristoSession) => Promise<void>;
}) {
  const invitationId = String(input.invitationId || "").trim();
  const result =
    input.action === "accept"
      ? await acceptAgentInvitation(invitationId)
      : await declineAgentInvitation(invitationId);

  const platformRole = (result.platformRole || null) as PlatformRole | null;
  const offlineActivationRole = (result.offlineActivationRole || platformRole || null) as PlatformRole | null;

  if (input.action === "accept" && platformRole) {
    const next = {
      ...input.session,
      platformRole,
      offlineActivationRole: offlineActivationRole || platformRole,
    };
    await input.setSession(next);
    console.log("KRISTO_AGENT_INVITE_ACCEPTED_SESSION_SYNC", {
      userId: input.session.userId,
      platformRole,
    });
  }

  clearAgentInviteCaches(String(input.session.userId || "").trim());

  console.log("KRISTO_INVITATIONS_OFFLINE_AGENT_RESPOND_SUCCESS", {
    userId: input.session.userId,
    invitationId,
    action: input.action,
    platformRole,
  });

  return {
    invitation: result.invitation,
    platformRole,
    offlineActivationRole,
  };
}
