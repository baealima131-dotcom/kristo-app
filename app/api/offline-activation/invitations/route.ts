import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listPendingInvitationsForUser } from "@/app/api/_lib/offlineActivationInvitations";
import { guardAuth } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  console.log("KRISTO_SUPERVISOR_INVITES_LOAD", { userId });

  const invitations = await listPendingInvitationsForUser(userId);

  return json({
    ok: true,
    invitations,
  });
}
