import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard, guardAuth } from "@/app/api/_lib/rbac";
import {
  approveMembership,
  cancelPendingJoinRequest,
  getMembershipsForChurch,
  isApproverForChurch,
  isJoinRequestMembership,
  normalizeMembershipChurchId,
  rejectMembership,
  requestMembership,
} from "@/app/api/_lib/memberships";
import { getProfileByUserCode } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function h(req: NextRequest, name: string) {
  return String(req.headers.get(name) || "").trim();
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const headerChurchId = normalizeMembershipChurchId(h(req, "x-kristo-church-id"));
  let targetChurchId = normalizeMembershipChurchId(ctxOrRes.churchId);

  if (
    headerChurchId &&
    headerChurchId !== targetChurchId &&
    (await isApproverForChurch(ctxOrRes.viewer.userId, headerChurchId))
  ) {
    targetChurchId = headerChurchId;
  }

  const all = await getMembershipsForChurch(targetChurchId, "Requested");
  const items = all.filter((m) => isJoinRequestMembership(m));

  console.log("KRISTO_JOIN_REQUESTS_LIST", {
    viewerUserId: ctxOrRes.viewer.userId,
    activeChurchId: normalizeMembershipChurchId(ctxOrRes.churchId),
    headerChurchId,
    targetChurchId,
    count: items.length,
  });

  return json({ ok: true, data: items, items, churchId: targetChurchId });
}

export async function POST(req: NextRequest) {
  const userId = h(req, "x-kristo-user-id");
  if (!userId) return json({ ok: false, error: "userId missing" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const churchId = String(body?.churchId || "").trim();
  const name = String(body?.name || body?.displayName || "").trim();

  if (!churchId) return json({ ok: false, error: "churchId missing" }, { status: 400 });

  const profile = /^KR7-[A-Z0-9]{6,10}$/i.test(userId)
    ? await getProfileByUserCode(userId)
    : null;

  const realUserId = String(
    (profile as any)?.userId ||
    (profile as any)?.id ||
    userId
  ).trim();

  const result = await requestMembership(realUserId, churchId, name || undefined);
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

  return json({ ok: true, data: result.membership, membership: result.membership });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "cancel") {
    const authOrRes = await guardAuth(req);
    if (authOrRes instanceof NextResponse) return authOrRes;

    const requestId = String(body?.requestId || body?.id || body?.membershipId || "").trim();
    const churchId = normalizeMembershipChurchId(body?.churchId || h(req, "x-kristo-church-id"));

    const result = await cancelPendingJoinRequest(authOrRes.viewer.userId, {
      membershipId: requestId || undefined,
      churchId: churchId || undefined,
    });

    if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

    return json({ ok: true, data: result.membership, membership: result.membership });
  }

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const requestId = String(body?.requestId || body?.id || "").trim();

  if (!requestId) return json({ ok: false, error: "requestId missing" }, { status: 400 });

  const result =
    action === "approve"
      ? await approveMembership(requestId, ctxOrRes.viewer.userId)
      : await rejectMembership(requestId, ctxOrRes.viewer.userId);

  if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

  return json({ ok: true, data: result.membership, membership: result.membership });
}
