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
  dbGetSafetySupervisorDashboard,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{
      reportId: string;
    }>;
  }
) {
  const auth =
    await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const supervisorUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  const allowed =
    await dbHasSafetyRole(
      supervisorUserId,
      "Safety_Supervisor"
    );

  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety Supervisor access required.",
      },
      {
        status: 403,
      }
    );
  }

  const params =
    await context.params;

  const reportId =
    decodeURIComponent(
      String(
        params?.reportId || ""
      )
    ).trim();

  if (!reportId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety report ID is required.",
      },
      {
        status: 400,
      }
    );
  }

  const dashboard =
    await dbGetSafetySupervisorDashboard(
      supervisorUserId
    );

  const report =
    dashboard.reports.find(
      (row) =>
        String(row.id || "").trim() ===
        reportId
    );

  if (!report) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Report was not found or is not assigned to this supervisor.",
      },
      {
        status: 404,
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      report,
      agents:
        dashboard.agents,
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, no-cache, must-revalidate",
      },
    }
  );
}
