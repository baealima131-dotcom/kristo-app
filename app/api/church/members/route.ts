import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { deactivateMemberInChurch, getMembershipsForChurch, setMemberRole, type ChurchRole } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getProfile } from "@/app/api/auth/_lib/profile";

type ChurchMember = {
  // ✅ keep both for compatibility across UIs
  id: string; // alias of membershipId
  membershipId: string;

  churchId: string;
  userId: string;

  name: string;
  roleLabel?: string; // churchRole label

  role: ChurchRole; // actual churchRole
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

function logMembersRouteError(
  phase: string,
  error: unknown,
  context: { churchId?: string; userId?: string; memberUserId?: string }
) {
  const err = error as { name?: string; message?: string };
  console.error("KRISTO_CHURCH_MEMBERS_ROUTE_ERROR", {
    route: "/api/church/members",
    phase,
    churchId: String(context.churchId || ""),
    userId: String(context.userId || ""),
    memberUserId: String(context.memberUserId || ""),
    errorName: String(err?.name || "Error"),
    errorMessage: String(err?.message || error || "unknown"),
  });
}

function membershipToMemberRow(m: {
  id: string;
  churchId: string;
  userId: string;
  churchRole?: ChurchRole;
  name?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt?: string;
}, profile: any | null): ChurchMember {
  const membershipId = m.id;
  const role = (m.churchRole ?? "Member") as ChurchRole;
  const name = String(
    profile?.fullName ||
      profile?.displayName ||
      m.name ||
      profile?.email ||
      "Church member"
  ).trim();

  return {
    id: membershipId,
    membershipId,
    churchId: m.churchId,
    userId: m.userId,
    name,
    userCode: profile?.userCode || "",
    kristoId: profile?.userCode || "",
    avatarUrl: profile?.avatarUrl || "",
    roleLabel: role,
    role,
    joinedAt: m.decidedAt || m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  let churchId = "";
  let userId = "";

  try {
    const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
    if (ctxOrRes instanceof NextResponse) return ctxOrRes;

    churchId = String(ctxOrRes.churchId || "").trim();
    userId = String(ctxOrRes.viewer?.userId || "").trim();

    const list = await getMembershipsForChurch(churchId, "Active");
    if (!Array.isArray(list) || list.length === 0) {
      return json({ ok: true, data: [] });
    }

    const items = await Promise.all(
      list.map(async (m) => {
        try {
          const profile = await getProfile(String(m.userId || "")).catch(() => null);
          return membershipToMemberRow(m, profile);
        } catch (memberError) {
          logMembersRouteError("member-enrich", memberError, {
            churchId,
            userId,
            memberUserId: String(m.userId || ""),
          });
          return membershipToMemberRow(m, null);
        }
      })
    );

    return json({ ok: true, data: items });
  } catch (error) {
    logMembersRouteError("get", error, { churchId, userId });
    return json({ ok: false, error: "Failed to load church members" }, { status: 500 });
  }
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
