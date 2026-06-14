import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { leaveActiveMembership } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getProfileByUserCode } from "@/app/api/auth/_lib/profile";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { viewer, churchId } = ctxOrRes;

  const headerUserId = String(req.headers.get("x-kristo-user-id") || viewer.userId || "").trim();
  const profile = /^KR7-[A-Z0-9]{6,10}$/i.test(headerUserId)
    ? await getProfileByUserCode(headerUserId)
    : null;

  const profileUserId = String((profile as any)?.userId || (profile as any)?.id || "").trim();
  const viewerUserId = String(viewer.userId || headerUserId || "").trim();

  // Guard resolves membership under viewer.userId; try that id first.
  let r = await leaveActiveMembership(viewerUserId);
  if (!r.ok && profileUserId && profileUserId !== viewerUserId) {
    r = await leaveActiveMembership(profileUserId);
  }
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  await createNotification({
    churchId: r.membership?.churchId || churchId,
    type: "Generic",
    title: "You left the church",
    message: `You are no longer an Active member.`,
    targetUserId: r.membership?.userId || viewerUserId,
  });

  return json({ ok: true, membership: r.membership });
}
