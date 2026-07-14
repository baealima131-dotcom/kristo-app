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
  dbAssignSafetyReportsToSupervisorByQuantity,
  dbGetSafetySystemAdminDashboard,
} from "@/app/api/_lib/store/safetyReportDb";

import {
  dbListSafetyRoles,
} from "@/app/api/_lib/store/safetyDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  const body =
    await req.json().catch(() => ({}));

  const supervisorUserId =
    String(
      body?.supervisorUserId || ""
    ).trim();

  const quantity = Math.floor(
    Number(body?.quantity) || 0
  );

  if (!supervisorUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Supervisor user ID is required.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    !Number.isFinite(quantity) ||
    quantity < 1 ||
    quantity > 5000
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Quantity must be between 1 and 5000.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const supervisors =
      await dbListSafetyRoles(
        "Safety_Supervisor"
      );

    const supervisorExists =
      supervisors.some(
        (row: any) =>
          String(
            row?.userId ||
            row?.user_id ||
            ""
          ).trim() ===
          supervisorUserId
      );

    if (!supervisorExists) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Active Safety Supervisor not found.",
        },
        {
          status: 404,
        }
      );
    }

    const assignment =
      await dbAssignSafetyReportsToSupervisorByQuantity(
        {
          supervisorUserId,
          quantity,
        }
      );

    const dashboard =
      await dbGetSafetySystemAdminDashboard();

    console.log(
      "KRISTO_SAFETY_REPORTS_ASSIGNED_BY_QUANTITY",
      {
        byUserId:
          auth.viewer.userId,
        supervisorUserId,
        requestedQuantity:
          assignment.requestedQuantity,
        assignedCount:
          assignment.assignedCount,
      }
    );

    return NextResponse.json({
      ok: true,
      assignment,
      dashboard,
    });
  } catch (error: any) {
    console.error(
      "KRISTO_SAFETY_REPORT_QUANTITY_ASSIGN_FAILED",
      {
        byUserId:
          auth.viewer.userId,
        supervisorUserId,
        quantity,
        error: String(
          error?.message || error
        ),
      }
    );

    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not assign reports."
        ),
      },
      {
        status: 500,
      }
    );
  }
}
