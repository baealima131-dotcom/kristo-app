import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";
import {
  dbListSafetyRolesForUser,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbHasActiveSafetyAgentRelationship,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const [
    roles,
    hasActiveSafetyAgentRelationship,
  ] = await Promise.all([
    dbListSafetyRolesForUser(
      auth.viewer.userId
    ),

    dbHasActiveSafetyAgentRelationship(
      auth.viewer.userId
    ),
  ]);

  const hasSafetyAgentRole =
    roles.some(
      (row) =>
        row.role ===
        "Safety_Agent"
    );

  const isSafetyAgent =
    hasSafetyAgentRole &&
    hasActiveSafetyAgentRelationship;

  console.log(
    "KRISTO_SAFETY_ACCESS_RESOLVED",
    {
      userId:
        auth.viewer.userId,

      hasSafetyAgentRole,

      hasActiveSafetyAgentRelationship,

      isSafetyAgent,
    }
  );

  return NextResponse.json({
    ok: true,
    roles,

    isSafetySupervisor:
      roles.some(
        (row) =>
          row.role ===
          "Safety_Supervisor"
      ),

    isSafetyAgent,

    hasSafetyAgentRole,

    hasActiveSafetyAgentRelationship,
  });
}
