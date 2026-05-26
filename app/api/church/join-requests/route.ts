import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  approveMembership,
  getMembershipsForChurch,
  rejectMembership,
  requestMembership,
} from "@/app/api/_lib/memberships";
import { getProfileByUserCode } from "@/app/api/auth/_lib/profile";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function h(req: NextRequest, name: string) {
  return String(req.headers.get(name) || "").trim();
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const all = await getMembershipsForChurch(ctxOrRes.churchId, "Requested");
  const items = all.filter((m: any) => String(m?.requestSource || "JoinRequest") !== "ChurchInvite");
  return json({ ok: true, data: items, items });
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

  const result = await requestMembership(realUserId, churchId, name);
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

  return json({ ok: true, data: result.membership, membership: result.membership });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const requestId = String(body?.requestId || body?.id || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();

  if (!requestId) return json({ ok: false, error: "requestId missing" }, { status: 400 });

  const result =
    action === "approve"
      ? await approveMembership(requestId, ctxOrRes.userId)
      : await rejectMembership(requestId, ctxOrRes.userId);

  if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

  return json({ ok: true, data: result.membership, membership: result.membership });
}
