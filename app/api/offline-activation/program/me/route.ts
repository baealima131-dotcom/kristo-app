import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getActiveMembership } from "@/app/api/_lib/memberships";
import {
  assertProgramMemberAllowed,
  listLeaderConfirmations,
} from "@/app/api/_lib/offlineActivationProgram";
import { guardProgramUser, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";
import { resolvePlatformRoleForUser } from "@/app/api/_lib/platformRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Which program cards the More tab may show. Decided on the server from current permissions. */
export async function GET(req: NextRequest) {
  const user = await guardProgramUser(req);
  if (user instanceof NextResponse) return user;
  try {
    const active = await getActiveMembership(user.userId);
    const platformRole = await resolvePlatformRoleForUser(user.userId, active?.churchRole);
    let roleActive = false;
    if (platformRole === "Supervisor" || platformRole === "Agent") {
      roleActive = await assertProgramMemberAllowed(user.userId, platformRole).then(
        () => true,
        () => false
      );
    }
    const pending = await listLeaderConfirmations(user.userId);
    return json({
      ok: true,
      cards: {
        supervisor: platformRole === "Supervisor" && roleActive,
        agent: platformRole === "Agent" && roleActive,
        leaderConfirmations: pending.length,
        // Entering a supervisor's invite code needs church membership and no program role yet.
        canJoinAsAgent: !platformRole && Boolean(active?.churchId),
      },
    });
  } catch (error) {
    return programErrorResponse(error);
  }
}
