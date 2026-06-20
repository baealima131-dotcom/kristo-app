import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import {
  approveMembership,
  getMembershipById,
  getChurchInvitesForViewer,
  isChurchInviteMembership,
  isPendingChurchInviteStatus,
  membershipBelongsToViewer,
  parseTargetKristoIdFromMembership,
  rejectMembership,
  resolveMembershipStoreMode,
} from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getProfile } from "@/app/api/auth/_lib/profile";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function normalizeInviteRow(m: Record<string, unknown>) {
  const status = isPendingChurchInviteStatus(m.status) ? "Requested" : m.status;
  const targetKristoId = parseTargetKristoIdFromMembership(m);
  return {
    ...m,
    status,
    ...(targetKristoId ? { targetKristoId } : {}),
  } as Record<string, unknown> & { id?: string; status: unknown; targetKristoId?: string };
}

export async function GET(req: NextRequest) {
  const a = await guardAuth(req);
  if (a instanceof NextResponse) return a;

  const viewerUserId = String(a.viewer.userId || "").trim();
  const profile = await getProfile(viewerUserId);
  const viewerKristoId = String((profile as any)?.userCode || "").trim().toUpperCase();
  const storeMode = resolveMembershipStoreMode();

  const invites = await getChurchInvitesForViewer(viewerUserId, viewerKristoId);
  const data = invites.map((m) => normalizeInviteRow(m as unknown as Record<string, unknown>));

  console.log(
    JSON.stringify({
      tag: "KRISTO_PROFILE_INVITES_QUERY",
      viewerUserId,
      viewerKristoId: viewerKristoId || null,
      count: data.length,
      inviteIds: data.map((row) => String(row.id || "")),
      storeMode,
    })
  );

  return json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const a = await guardAuth(req);
  if (a instanceof NextResponse) return a;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const membershipId = String(body?.membershipId || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();

  if (!membershipId) {
    return json({ ok: false, error: "Missing membershipId" }, { status: 400 });
  }

  const viewerUserId = String(a.viewer.userId || "").trim();
  const profile = await getProfile(viewerUserId);
  const viewerKristoId = String((profile as any)?.userCode || "").trim().toUpperCase();

  const membership = await getMembershipById(membershipId);
  if (!membership || !isChurchInviteMembership(membership)) {
    return json({ ok: false, error: "Invite not found" }, { status: 404 });
  }
  if (!membershipBelongsToViewer(membership, viewerUserId, viewerKristoId)) {
    return json({ ok: false, error: "Invite not found" }, { status: 404 });
  }

  if (action === "accept") {
    const r = await approveMembership(membershipId, viewerUserId);
    if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

    await createNotification({
      churchId: r.membership.churchId,
      type: "Generic",
      title: "You joined a church",
      message: "Welcome! You are now a member.",
      targetUserId: r.membership.userId,
    });

    return json({
      ok: true,
      data: normalizeInviteRow(r.membership as unknown as Record<string, unknown>),
    });
  }

  if (action === "reject") {
    const r = await rejectMembership(membershipId, viewerUserId);
    if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

    return json({
      ok: true,
      data: normalizeInviteRow(r.membership as unknown as Record<string, unknown>),
    });
  }

  return json({ ok: false, error: "Invalid action" }, { status: 400 });
}
