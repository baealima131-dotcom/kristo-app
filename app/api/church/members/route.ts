import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { deactivateMemberInChurch, getMembershipsForChurch, setMemberRole, type ChurchMembership, type ChurchRole } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { ensureProfileDraft, getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

type ChurchMember = {
  // ✅ keep both for compatibility across UIs
  id: string; // alias of membershipId
  membershipId: string;

  churchId: string;
  userId: string;
  userCode?: string;
  kristoId?: string;

  name: string;
  fullName?: string;
  displayName?: string;
  roleLabel?: string; // churchRole label

  role: ChurchRole; // actual churchRole
  avatarUrl?: string;
  avatarUri?: string;
  profileImage?: string;
  photoURL?: string;
  image?: string;

  joinedAt: string;
  updatedAt?: string;
};

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function normalizeChurchRole(x: any): ChurchRole {
  const s = String(x || "").trim();
  if (s === "Pastor") return "Pastor";
  if (s === "Church_Admin") return "Church_Admin";
  if (s === "Leader") return "Leader";
  return "Member";
}

function isKristoUserCode(x: string) {
  return /^KR7-[A-Z0-9]{6,10}$/i.test(String(x || "").trim());
}

function pickAvatar(profile: any, user: any) {
  return String(
    profile?.avatarUrl ||
    profile?.avatarUri ||
    profile?.profileImage ||
    profile?.photoURL ||
    profile?.image ||
    user?.avatarUrl ||
    user?.avatarUri ||
    user?.profileImage ||
    user?.photoURL ||
    user?.image ||
    ""
  ).trim();
}

async function resolveMemberProfile(membershipUserId: string) {
  const raw = String(membershipUserId || "").trim();
  if (!raw) return { profile: null as any, user: null as any, resolvedUserId: "" };

  let profile: any = (await getProfile(raw)) || null;

  if (!profile && isKristoUserCode(raw)) {
    profile = (await getProfileByUserCode(raw)) || null;
  }

  if (!profile && raw !== raw.toLowerCase()) {
    profile = (await getProfile(raw.toLowerCase())) || null;
  }

  const resolvedUserId = String(profile?.userId || raw).trim();
  const user: any = resolvedUserId ? await getUserById(resolvedUserId) : null;

  if (!profile && user) {
    profile = (await getProfile(resolvedUserId)) || null;
  }

  return { profile, user, resolvedUserId };
}

async function enrichChurchMember(m: ChurchMembership): Promise<ChurchMember> {
  const membershipId = m.id;
  const role = (m.churchRole ?? "Member") as ChurchRole;
  const { profile, user, resolvedUserId } = await resolveMemberProfile(String(m.userId || ""));

  if (!profile && resolvedUserId) {
    await ensureProfileDraft({
      userId: resolvedUserId,
      fullName: m.name || "Member",
    });
  }

  const refreshed: any = profile || (resolvedUserId ? await getProfile(resolvedUserId) : null);
  const avatar = pickAvatar(refreshed, user);
  const userCode = String(refreshed?.userCode || "").trim().toUpperCase();
  const name = String(
    refreshed?.fullName ||
    refreshed?.displayName ||
    m.name ||
    user?.fullName ||
    user?.displayName ||
    user?.name ||
    refreshed?.email ||
    user?.email ||
    "Church member"
  ).trim();

  return {
    id: membershipId,
    membershipId,
    churchId: m.churchId,
    userId: resolvedUserId || String(m.userId || ""),
    userCode,
    kristoId: userCode,
    name,
    fullName: name,
    displayName: name,
    avatarUrl: avatar,
    avatarUri: avatar,
    profileImage: avatar,
    roleLabel: role,
    role,
    joinedAt: m.decidedAt || m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const list = await getMembershipsForChurch(ctxOrRes.churchId, "Active");

  const items = await Promise.all(list.map(enrichChurchMember));

  if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
    console.log(
      "[church/members] avatar fields",
      items.map((row) => ({
        userId: row.userId,
        name: row.name,
        role: row.role,
        avatarUrl: row.avatarUrl ? `${String(row.avatarUrl).slice(0, 48)}…` : "",
        hasAvatar: Boolean(row.avatarUrl),
      }))
    );
  }

  return json({ ok: true, data: items });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({} as any));
  const userId = String(body?.userId || body?.memberId || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();
  const role = normalizeChurchRole(body?.role);

  if (!userId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

  if (action === "deactivate" || action === "remove") {
    const r = await deactivateMemberInChurch(ctxOrRes.churchId, userId);
    if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

    createNotification({
      churchId: ctxOrRes.churchId,
      type: "Generic",
      title: "Church membership updated",
      message: "You were removed from this church.",
      targetUserId: userId,
    });

    return json({ ok: true, data: r.membership });
  }

  const r = await setMemberRole(ctxOrRes.churchId, userId, role);
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  // ✅ notify the target user
  createNotification({
    churchId: ctxOrRes.churchId,
    type: "Generic",
    title: "Church role updated",
    message: `Your church role is now ${role}.`,
    targetUserId: userId,
  });

  return json({ ok: true, data: r.membership });
}
