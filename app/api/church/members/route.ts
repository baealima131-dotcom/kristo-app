import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForChurch, setMemberRole, type ChurchRole } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

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

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const list = await getMembershipsForChurch(ctxOrRes.churchId, "Active");

  const items = list.map((m) => {
    const membershipId = m.id;
    const role = (m.churchRole ?? "Member") as ChurchRole;
    const name = String(m.name || "").trim() || "Member";

    const out: ChurchMember = {
      id: membershipId,
      membershipId,

      churchId: m.churchId,
      userId: m.userId,

      name,
      roleLabel: role,

      role,
      joinedAt: m.decidedAt || m.createdAt,
      updatedAt: m.updatedAt,
    };

    return out;
  });

  return json({ ok: true, data: items });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({} as any));
  const userId = String(body?.userId || "").trim();
  const role = normalizeChurchRole(body?.role);

  if (!userId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

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
