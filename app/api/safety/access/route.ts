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

  /*
   * A live supervisor-agent relationship is the
   * operational Safety Agent authority.
   *
   * Invitation acceptance is not required once a
   * supervisor has registered and activated the agent.
   */
  const isSafetyAgent =
    hasActiveSafetyAgentRelationship;

  console.log(
    "KRISTO_SAFETY_ACCESS_RESOLVED",
    {
      userId:
        auth.viewer.userId,

      hasSafetyAgentRole,

      hasActiveSafetyAgentRelationship,

      isSafetyAgent,

      agentAccessSource:
        hasActiveSafetyAgentRelationship
          ? "active_supervisor_relationship"
          : "none",
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
