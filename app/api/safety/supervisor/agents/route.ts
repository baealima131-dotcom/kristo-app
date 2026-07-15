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
  dbCreateSupervisorAgent,
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

  const dashboard =
    await dbGetSafetySupervisorDashboard(
      access.supervisorUserId
    );

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

    if (existing) {
      return NextResponse.json({
        ok: true,
        outcome: "alreadyAdded",
        agent: existing,
      });
    }

    await dbCreateSupervisorAgent({
      supervisorUserId:
        access.supervisorUserId,

      agentUserId:
        resolved.userId,

      agentKristoId:
        resolved.kristoId,

      churchId:
        resolved.churchId,

      status: "active",
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
        "Safety Agent was created but could not be reloaded."
      );
    }

    console.log(
      "KRISTO_SAFETY_AGENT_ADDED",
      {
        supervisorUserId:
          access.supervisorUserId,

        agentUserId:
          resolved.userId,

        kristoId:
          resolved.kristoId,

        churchId:
          resolved.churchId,
      }
    );

    return NextResponse.json({
      ok: true,
      outcome: "added",
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
