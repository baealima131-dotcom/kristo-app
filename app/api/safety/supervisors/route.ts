import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guardPlatformOfflineActivation,
} from "@/app/api/_lib/rbac";
import {
  dbListPendingSafetySupervisorInvitations,
  dbListSafetyRoles,
} from "@/app/api/_lib/store/safetyDb";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardPlatformOfflineActivation(
      req,
      ["System_Admin"]
    );

  if (auth instanceof NextResponse) {
    return auth;
  }

  const [
    supervisors,
    pendingInvitations,
  ] = await Promise.all([
    dbListSafetyRoles(
      "Safety_Supervisor"
    ),
    dbListPendingSafetySupervisorInvitations(),
  ]);

  return NextResponse.json({
    ok: true,
    supervisors,
    pendingInvitations,
    counts: {
      active: supervisors.length,
      pending:
        pendingInvitations.length,
    },
  });
}
