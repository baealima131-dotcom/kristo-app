import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  getActiveMembership,
  requestMembership,
  saveMembership,
  withTargetKristoIdNote,
  resolveMembershipStoreMode,
  type ChurchRole,
} from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import { sendChurchInviteEmail } from "@/app/api/_lib/email";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function normalizeRole(x: any): ChurchRole {
  const s = String(x || "").trim();
  if (s === "Leader") return "Leader";
  if (s === "Ministry_Leader") return "Ministry_Leader";
  if (s === "Church_Admin") return "Church_Admin";
  if (s === "Pastor") return "Pastor";
  return "Member";
}

export async function POST(req: NextRequest) {
  const ctx = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => ({} as any));
  const targetUserId = String(body?.userId || body?.targetUserId || "").trim().toUpperCase();
  const role = normalizeRole(body?.role);

  if (!targetUserId) return json({ ok: false, error: "Missing Kristo ID" }, { status: 400 });

  // ❌ block self invite: compare header KR7 + guard userId
  const actorHeaderId = String(req.headers.get("x-kristo-user-id") || "").trim().toUpperCase();
  const actorProfile = await getProfile(ctx.viewer.userId);
  const actorCodes = [
    actorHeaderId,
    String(ctx.viewer.userId || ""),
    String((actorProfile as any)?.userCode || ""),
    String((actorProfile as any)?.coreId || ""),
    String((actorProfile as any)?.coreIdBirth || ""),
  ].map((x) => x.trim().toUpperCase()).filter(Boolean);

  if (actorCodes.includes(targetUserId)) {
    return json({ ok: false, error: "You cannot invite yourself" }, { status: 400 });
  }
  if (!/^KR7-[A-Z0-9]{6,10}$/.test(targetUserId)) {
    return json({ ok: false, error: "Invalid Kristo ID" }, { status: 400 });
  }

  // Validate against the Kristo ID generated during signup/profile creation.
  const targetProfile = await getProfileByUserCode(targetUserId);
  if (!targetProfile) {
    return json({ ok: false, error: "This Kristo ID does not exist" }, { status: 404 });
  }

  const realTargetUserId = String(
    (targetProfile as any)?.userId ||
    (targetProfile as any)?.id ||
    targetUserId
  ).trim();

  const active = await getActiveMembership(realTargetUserId);
  if (active && active.churchId !== ctx.churchId) {
    return json({ ok: false, error: "This user is already a member of another church" }, { status: 409 });
  }

  const r = await requestMembership(realTargetUserId, ctx.churchId, undefined, "ChurchInvite");
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  let membership = withTargetKristoIdNote(r.membership, targetUserId);
  membership.churchRole = role;
  membership = await saveMembership(membership);

  console.log(
    JSON.stringify({
      tag: "KRISTO_CHURCH_INVITE_CREATE",
      churchId: ctx.churchId,
      senderUserId: ctx.viewer.userId,
      targetKristoId: targetUserId,
      resolvedTargetUserId: realTargetUserId,
      status: membership.status,
      storeMode: resolveMembershipStoreMode(),
    })
  );

  createNotification({
    churchId: ctx.churchId,
    type: "Generic",
    title: "Church invite received",
    message: `You have been invited to join this church as ${role}.`,
    ministryMemberId: membership.id,
    targetUserId: realTargetUserId,
  });

  const targetEmail =
    String((targetProfile as any)?.email || (targetProfile as any)?.emailAddress || "").trim() || null;

  const emailResult = await sendChurchInviteEmail({
    to: targetEmail,
    role,
    churchName: String((ctx as any)?.churchName || "your church"),
  }).catch((error) => ({ error: String(error?.message || error) }));

  return json({ ok: true, invite: membership, email: emailResult });
}
