import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  dbHasSafetyRole,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbGetSafetyAgentDashboard,
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
    await dbHasSafetyRole(
      agentUserId,
      "Safety_Agent"
    );

  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety Agent access required.",
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
