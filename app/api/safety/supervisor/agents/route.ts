import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  dbCreateSafetyInvite,
  dbHasSafetyRole,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbAssignReportsToAgent,
  dbCreateSupervisorAgent,
  dbRemoveSupervisorAgent,
  dbGetSafetySupervisorDashboard,
} from "@/app/api/_lib/store/safetyReportDb";

import {
  resolveAgentRegistrationByKristoAndChurch,
} from "@/app/api/_lib/offlineActivationAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function requireSafetySupervisor(
  req: NextRequest
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

  return {
    supervisorUserId,
  };
}

export async function GET(
  req: NextRequest
) {
  const access =
    await requireSafetySupervisor(req);

  if (access instanceof NextResponse) {
    return access;
  }

  let dashboard =
    await dbGetSafetySupervisorDashboard(
      access.supervisorUserId
    );

  let reconciledLegacyAgent = false;

  for (const agent of dashboard.agents) {
    if (agent.status !== "active") {
      continue;
    }

    const hasAcceptedSafetyAgentRole =
      await dbHasSafetyRole(
        agent.userId,
        "Safety_Agent"
      );

    if (hasAcceptedSafetyAgentRole) {
      continue;
    }

    /*
     * Legacy protection:
     * Agents created before invitation-first onboarding
     * may still have an active supervisor link without
     * ever accepting a Safety_Agent invitation.
     */
    await dbCreateSafetyInvite({
      inviteeUserId:
        agent.userId,

      inviteeKristoId:
        String(
          agent.kristoId || ""
        )
          .trim()
          .toUpperCase(),

      churchId:
        agent.churchId,

      invitedByUserId:
        access.supervisorUserId,

      role: "Safety_Agent",
    });

    await dbCreateSupervisorAgent({
      supervisorUserId:
        access.supervisorUserId,

      agentUserId:
        agent.userId,

      agentKristoId:
        agent.kristoId,

      churchId:
        agent.churchId,

      status: "pending",
    });

    reconciledLegacyAgent = true;

    console.log(
      "KRISTO_LEGACY_SAFETY_AGENT_DOWNGRADED_TO_PENDING",
      {
        supervisorUserId:
          access.supervisorUserId,

        agentUserId:
          agent.userId,

        kristoId:
          agent.kristoId,

        churchId:
          agent.churchId,
      }
    );
  }

  if (reconciledLegacyAgent) {
    dashboard =
      await dbGetSafetySupervisorDashboard(
        access.supervisorUserId
      );
  }

  return NextResponse.json(
    {
      ok: true,
      agents: dashboard.agents,
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
  req: NextRequest
) {
  const access =
    await requireSafetySupervisor(req);

  if (access instanceof NextResponse) {
    return access;
  }

  const body =
    await req.json().catch(
      () => ({})
    );

  const action =
    String(
      body?.action || ""
    )
      .trim()
      .toLowerCase();


  if (action === "assign_reports") {
    const agentUserId =
      String(
        body?.agentUserId || ""
      ).trim();

    const requestedCount =
      Math.floor(
        Number(body?.count) || 0
      );

    if (!agentUserId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Agent user ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (requestedCount < 1) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Enter the number of reports to assign.",
        },
        {
          status: 400,
        }
      );
    }

    const before =
      await dbGetSafetySupervisorDashboard(
        access.supervisorUserId
      );

    const agent =
      before.agents.find(
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

    const availableReports =
      before.reports.filter(
        (report) =>
          !report.assignedAgentUserId &&
          report.status !==
            "resolved" &&
          report.status !==
            "dismissed"
      );

    if (!availableReports.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "There are no unassigned reports available.",
          availableCount: 0,
        },
        {
          status: 409,
        }
      );
    }

    if (
      requestedCount >
      availableReports.length
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `Only ${availableReports.length} unassigned reports are available.`,
          availableCount:
            availableReports.length,
        },
        {
          status: 409,
        }
      );
    }

    const assignedReports =
      await dbAssignReportsToAgent({
        supervisorUserId:
          access.supervisorUserId,

        agentUserId,

        count:
          requestedCount,
      });

    if (
      assignedReports.length !==
      requestedCount
    ) {
      const latest =
        await dbGetSafetySupervisorDashboard(
          access.supervisorUserId
        );

      const latestAvailable =
        latest.reports.filter(
          (report) =>
            !report.assignedAgentUserId &&
            report.status !==
              "resolved" &&
            report.status !==
              "dismissed"
        ).length;

      return NextResponse.json(
        {
          ok: false,
          error:
            assignedReports.length > 0
              ? `${assignedReports.length} reports were assigned because the available queue changed.`
              : "The available report queue changed. Please try again.",
          assignedCount:
            assignedReports.length,
          availableCount:
            latestAvailable,
          agents:
            latest.agents,
        },
        {
          status: 409,
        }
      );
    }

    const dashboard =
      await dbGetSafetySupervisorDashboard(
        access.supervisorUserId
      );

    const remainingAvailable =
      dashboard.reports.filter(
        (report) =>
          !report.assignedAgentUserId &&
          report.status !==
            "resolved" &&
          report.status !==
            "dismissed"
      ).length;

    console.log(
      "KRISTO_SAFETY_REPORTS_BULK_ASSIGNED_TO_AGENT",
      {
        supervisorUserId:
          access.supervisorUserId,

        agentUserId,

        agentKristoId:
          agent.kristoId,

        requestedCount,

        assignedCount:
          assignedReports.length,

        remainingAvailable,
      }
    );

    return NextResponse.json({
      ok: true,
      assignedCount:
        assignedReports.length,
      availableCount:
        remainingAvailable,
      agents:
        dashboard.agents,
    });
  }

  if (action === "remove") {
    const agentUserId =
      String(
        body?.agentUserId || ""
      ).trim();

    const removeChurchId =
      String(
        body?.churchId || ""
      )
        .trim()
        .toUpperCase();

    if (
      !agentUserId ||
      !removeChurchId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Agent user ID and Church ID are required.",
        },
        {
          status: 400,
        }
      );
    }

    const removed =
      await dbRemoveSupervisorAgent({
        supervisorUserId:
          access.supervisorUserId,
        agentUserId,
        churchId:
          removeChurchId,
      });

    console.log(
      "KRISTO_SAFETY_AGENT_REMOVED",
      {
        supervisorUserId:
          access.supervisorUserId,
        agentUserId,
        churchId:
          removeChurchId,
        removed:
          removed.removed,
      }
    );

    return NextResponse.json({
      ok: true,
      removed:
        removed.removed,
    });
  }

  const kristoId =
    String(
      body?.kristoId || ""
    )
      .trim()
      .toUpperCase();

  const churchId =
    String(
      body?.churchId || ""
    )
      .trim()
      .toUpperCase();

  if (!kristoId || !churchId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "KRISTO ID and Church ID are required.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const resolved =
      await resolveAgentRegistrationByKristoAndChurch(
        kristoId,
        churchId
      );

    if (
      resolved.userId ===
      access.supervisorUserId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "You cannot add yourself as your own Safety Agent.",
        },
        {
          status: 400,
        }
      );
    }

    const alreadyHasRole =
      await dbHasSafetyRole(
        resolved.userId,
        "Safety_Agent"
      );

    const before =
      await dbGetSafetySupervisorDashboard(
        access.supervisorUserId
      );

    const existing =
      before.agents.find(
        (agent) =>
          agent.userId ===
            resolved.userId &&
          agent.churchId ===
            resolved.churchId
      );

    if (
      alreadyHasRole &&
      existing?.status === "active"
    ) {
      return NextResponse.json({
        ok: true,
        outcome: "alreadyActive",
        invitation: null,
        agent: existing,
      });
    }

    const invitation =
      await dbCreateSafetyInvite({
        inviteeUserId:
          resolved.userId,

        inviteeKristoId:
          resolved.kristoId,

        churchId:
          resolved.churchId,

        invitedByUserId:
          access.supervisorUserId,

        role: "Safety_Agent",
      });

    await dbCreateSupervisorAgent({
      supervisorUserId:
        access.supervisorUserId,

      agentUserId:
        resolved.userId,

      agentKristoId:
        resolved.kristoId,

      churchId:
        resolved.churchId,

      status: "pending",
    });

    const dashboard =
      await dbGetSafetySupervisorDashboard(
        access.supervisorUserId
      );

    const agent =
      dashboard.agents.find(
        (row) =>
          row.userId ===
            resolved.userId &&
          row.churchId ===
            resolved.churchId
      );

    if (!agent) {
      throw new Error(
        "Safety Agent invitation was created but the pending agent could not be reloaded."
      );
    }

    console.log(
      "KRISTO_SAFETY_AGENT_INVITATION_CREATED",
      {
        supervisorUserId:
          access.supervisorUserId,

        agentUserId:
          resolved.userId,

        kristoId:
          resolved.kristoId,

        churchId:
          resolved.churchId,

        invitationId:
          invitation.id,
      }
    );

    return NextResponse.json({
      ok: true,
      outcome:
        invitation.createdAt
          ? "invited"
          : "alreadyInvited",
      invitation,
      agent,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
          "Could not add Safety Agent."
        ),
      },
      {
        status: 400,
      }
    );
  }
}
