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
  dbAssignReportToAgent,
  dbGetSafetyAgentDashboard,
  dbGetSafetySupervisorDashboard,
  dbHasActiveSafetyAgentRelationship,
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

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  const viewerUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  if (!viewerUserId) {
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

  const [
    isSupervisor,
    isActiveAgent,
  ] = await Promise.all([
    dbHasSafetyRole(
      viewerUserId,
      "Safety_Supervisor"
    ),

    dbHasActiveSafetyAgentRelationship(
      viewerUserId
    ),
  ]);

  if (
    !isSupervisor &&
    !isActiveAgent
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety case access required.",
      },
      {
        status: 403,
      }
    );
  }

  if (isSupervisor) {
    const dashboard =
      await dbGetSafetySupervisorDashboard(
        viewerUserId
      );

    const report =
      dashboard.reports.find(
        (row) =>
          String(
            row.id || ""
          ).trim() ===
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
        viewerMode:
          "supervisor",
        permissions: {
          canInvestigate: true,
          canAssignAgent: true,
          canEscalate: true,
          canResolve: true,
        },
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

  const dashboard =
    await dbGetSafetyAgentDashboard(
      viewerUserId
    );

  const report =
    dashboard.reports.find(
      (row) =>
        String(
          row.id || ""
        ).trim() ===
          reportId &&
        String(
          row.assignedAgentUserId ||
            ""
        ).trim() ===
          viewerUserId
    );

  if (!report) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This case is not assigned to your Safety Agent account.",
      },
      {
        status: 403,
      }
    );
  }

  console.log(
    "KRISTO_SAFETY_AGENT_CASE_OPENED",
    {
      reportId,
      reportCode:
        report.reportCode,
      agentUserId:
        viewerUserId,
    }
  );

  return NextResponse.json(
    {
      ok: true,
      viewerMode:
        "agent",
      permissions: {
        canInvestigate: true,
        canAssignAgent: false,
        canEscalate: true,
        canResolve: true,
      },
      report,
      agents: [],
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(
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

  const body =
    await req.json().catch(
      () => ({})
    );

  const agentUserId =
    String(
      body?.agentUserId || ""
    ).trim();

  if (!reportId || !agentUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Report ID and Agent user ID are required.",
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

  if (
    report.status === "resolved" ||
    report.status === "dismissed"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Completed reports cannot be reassigned.",
      },
      {
        status: 409,
      }
    );
  }

  const agent =
    dashboard.agents.find(
      (row) =>
        row.userId ===
          agentUserId &&
        row.status ===
          "active"
    );

  if (!agent) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Choose an active Safety Agent from your team.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const assignedReport =
      await dbAssignReportToAgent({
        reportId,
        supervisorUserId,
        agentUserId,
      });

    const refreshedDashboard =
      await dbGetSafetySupervisorDashboard(
        supervisorUserId
      );

    console.log(
      "KRISTO_SAFETY_REPORT_ASSIGNED_TO_AGENT",
      {
        reportId,
        reportCode:
          assignedReport.reportCode,
        supervisorUserId,
        agentUserId,
        agentKristoId:
          agent.kristoId,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        report:
          refreshedDashboard.reports.find(
            (row) =>
              row.id === reportId
          ) || assignedReport,
        agents:
          refreshedDashboard.agents,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not assign this report."
        ),
      },
      {
        status: 400,
      }
    );
  }
}
