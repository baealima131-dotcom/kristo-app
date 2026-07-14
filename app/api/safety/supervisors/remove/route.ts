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
  dbHasSafetyRole,
  dbRemoveSafetyRole,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbReleaseSafetySupervisorReports,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  if (!supervisorUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety Supervisor user ID is required.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const exists =
      await dbHasSafetyRole(
        supervisorUserId,
        "Safety_Supervisor"
      );

    if (!exists) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Safety Supervisor access was not found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Reports are released first. If that fails,
     * the supervisor role remains intact.
     */
    const release =
      await dbReleaseSafetySupervisorReports(
        supervisorUserId
      );

    const removal =
      await dbRemoveSafetyRole({
        userId:
          supervisorUserId,
        role:
          "Safety_Supervisor",
      });

    console.log(
      "KRISTO_SAFETY_SUPERVISOR_REMOVED",
      {
        removedByUserId:
          auth.viewer.userId,
        supervisorUserId,
        releasedReportCount:
          release.releasedCount,
        roleRemoved:
          removal.removed,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        removed:
          removal.removed,
        releasedReportCount:
          release.releasedCount,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error(
      "KRISTO_SAFETY_SUPERVISOR_REMOVE_FAILED",
      {
        removedByUserId:
          auth.viewer.userId,
        supervisorUserId,
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
            "Could not remove Safety Supervisor."
        ),
      },
      {
        status: 500,
      }
    );
  }
}
