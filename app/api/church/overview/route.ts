import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { listNotifications } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function forwardAuthHeaders(req: NextRequest): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/json",
    cookie: req.headers.get("cookie") || "",
  };

  // DEV header-auth passthrough (safe even if empty)
  const uid = req.headers.get("x-kristo-user-id");
  const role = req.headers.get("x-kristo-role");
  const cid = req.headers.get("x-kristo-church-id");

  if (uid) h["x-kristo-user-id"] = uid;
  if (role) h["x-kristo-role"] = role;
  if (cid) h["x-kristo-church-id"] = cid;

  return h;
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = ctxOrRes.churchId;

  const activeMembers = await getMembershipsForChurch(churchId, "Active");

  const headers = forwardAuthHeaders(req);

  let ministriesCount = 0;
  try {
    const res = await fetch(new URL("/api/church/ministries", req.url), {
      headers,
      cache: "no-store",
    });
    const j = await res.json().catch(() => null);
    const list = j && j.ok === true && Array.isArray(j.data) ? j.data : [];
    ministriesCount = list.length;
  } catch {
    ministriesCount = 0;
  }

  // NOTE: ministry-members endpoint might require ministryId; keep safe.
  let ministryMembersCount = 0;
  try {
    const res = await fetch(new URL("/api/church/ministry-members?all=1", req.url), {
      headers,
      cache: "no-store",
    });
    const j = await res.json().catch(() => null);
    const list = j && j.ok === true && Array.isArray(j.data) ? j.data : [];
    ministryMembersCount = list.length;
  } catch {
    ministryMembersCount = 0;
  }

  const unreadNotifications = listNotifications({
    churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: true,
    limit: 9999,
  }).length;

  return json({
    ok: true,
    data: {
      churchId,
      viewer: ctxOrRes.viewer,
      stats: {
        activeMembers: activeMembers.length,
        ministries: ministriesCount,
        ministryMembers: ministryMembersCount,
        unreadNotifications,
      },
      generatedAt: new Date().toISOString(),
    },
  });
}
