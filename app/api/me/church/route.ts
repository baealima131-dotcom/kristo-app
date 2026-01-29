import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { getActiveMembership, getMembershipsForUser } from "@/app/api/_lib/memberships";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Returns the user's current church context (AUTH-ONLY).
 * - Requires login, but does NOT require active membership.
 * - If Active membership exists => activeChurchId from membership
 * - Else activeChurchId = "" and membership = null
 */
export async function GET(req: NextRequest) {
  const aOrRes = await guardAuth(req);
  if (aOrRes instanceof NextResponse) return aOrRes;

  const { userId, name } = aOrRes.viewer;

  const active = await getActiveMembership(userId);
  const memberships = await getMembershipsForUser(userId);

  return json({
    ok: true,
    viewer: {
      userId,
      name,
      role: active?.churchRole ? active.churchRole : "Member",
    },
    activeChurchId: active?.churchId || "",
    membership: active || null,
    memberships,
    source: active ? "membership_store" : "none",
  });
}
