import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { respondToAgentInvitation } from "@/app/api/_lib/offlineActivationInvitations";
import { guardAuth } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  const body = await req.json().catch(() => ({}));
  const invitationId = String(body?.invitationId || "").trim();

  if (!invitationId) {
    return json({ ok: false, error: "invitationId is required." }, { status: 400 });
  }

  console.log("KRISTO_AGENT_INVITE_DECLINE_START", { userId, invitationId });

  try {
    const result = await respondToAgentInvitation({
      invitationId,
      inviteeUserId: userId,
      action: "decline",
    });

    console.log("KRISTO_AGENT_INVITE_DECLINE_SUCCESS", {
      userId,
      invitationId,
      status: result.invitation.status,
    });

    return json({
      ok: true,
      invitation: result.invitation,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to decline invitation");
    console.warn("KRISTO_AGENT_INVITE_DECLINE_FAILED", { userId, invitationId, error: message });
    return json({ ok: false, error: message }, { status: 400 });
  }
}
