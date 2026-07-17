import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  dbGetSafetyAgentDashboard,
  dbHasActiveSafetyAgentRelationship,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function requireSafetyAgent(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  const agentUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  if (!agentUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You must be signed in.",
      },
      {
        status: 401,
      }
    );
  }

  const allowed =
    await dbHasActiveSafetyAgentRelationship(
      agentUserId
    );

  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "An active Safety Agent assignment is required.",
      },
      {
        status: 403,
      }
    );
  }

  return {
    agentUserId,
  };
}

export async function GET(
  req: NextRequest
) {
  const access =
    await requireSafetyAgent(req);

  if (
    access instanceof NextResponse
  ) {
    return access;
  }

  const dashboard =
    await dbGetSafetyAgentDashboard(
      access.agentUserId
    );

  return NextResponse.json(
    {
      ok: true,
      counts:
        dashboard.counts,
      reports:
        dashboard.reports,
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, no-cache, must-revalidate",
      },
    }
  );
}
