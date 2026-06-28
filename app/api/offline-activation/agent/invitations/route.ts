import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findSupervisorAgentByLinkedUser } from "@/app/api/_lib/offlineActivationAgentStore";
import { listPendingAgentInvitationsForUser } from "@/app/api/_lib/offlineActivationInvitations";
import { guardAuth } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  console.log("KRISTO_AGENT_INVITES_LOAD", { userId });

  const invitations = await listPendingAgentInvitationsForUser(userId);
  const enriched = await Promise.all(
    invitations.map(async (invitation) => {
      const agent = await findSupervisorAgentByLinkedUser(
        invitation.invitedByUserId,
        userId,
        invitation.churchId
      );
      return {
        ...invitation,
        agentRegistration: agent
          ? {
              id: agent.id,
              status: agent.status,
              kristoId: agent.kristoId,
              churchId: agent.churchId,
              fullName: agent.fullName,
              linkedUserId: agent.linkedUserId,
            }
          : null,
      };
    })
  );

  console.log("KRISTO_AGENT_INVITES_LIST_RESULT", {
    userId,
    count: enriched.length,
    invitationIds: enriched.map((row) => row.id),
  });

  return json({
    ok: true,
    invitations: enriched,
  });
}
