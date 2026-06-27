import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { respondToInvitation } from "@/app/api/_lib/offlineActivationInvitations";
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
  const action = String(body?.action || "").trim().toLowerCase();

  if (!invitationId) {
    return json({ ok: false, error: "invitationId is required." }, { status: 400 });
  }
  if (action !== "accept" && action !== "decline") {
    return json({ ok: false, error: 'action must be "accept" or "decline".' }, { status: 400 });
  }

  console.log("KRISTO_SUPERVISOR_INVITE_RESPOND_START", {
    userId,
    invitationId,
    action,
  });

  try {
    const result = await respondToInvitation({
      invitationId,
      inviteeUserId: userId,
      action: action as "accept" | "decline",
    });

    console.log("KRISTO_SUPERVISOR_INVITE_RESPOND_SUCCESS", {
      userId,
      invitationId,
      action,
      status: result.invitation.status,
      platformRole: result.platformRole,
    });

    return json({
      ok: true,
      invitation: result.invitation,
      platformRole: result.platformRole,
      offlineActivationRole: result.platformRole,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to respond to invitation");
    console.warn("KRISTO_SUPERVISOR_INVITE_RESPOND_FAILED", {
      userId,
      invitationId,
      action,
      error: message,
    });
    return json({ ok: false, error: message }, { status: 400 });
  }
}
