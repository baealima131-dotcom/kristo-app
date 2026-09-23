import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { dbRespondToSokoWorkforceInvitation } from "@/app/api/_lib/store/sokoWorkforceDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));

  try {
    const invitationId = String(body?.invitationId || "").trim();
    const action = String(body?.action || "").trim().toLowerCase();

    if (!invitationId) throw new Error("Work invitation ID is required");
    if (action !== "accept" && action !== "decline") {
      throw new Error("Action must be accept or decline");
    }

    const invitation = await dbRespondToSokoWorkforceInvitation({
      invitationId,
      inviteeUserId: String(auth.viewer.userId || "").trim(),
      action,
    });

    return NextResponse.json({ ok: true, invitation });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || "Could not respond to SOKO invitation") },
      { status: 400 }
    );
  }
}
