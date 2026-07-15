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
  dbGetSafetySystemAdminDashboard,
  dbGetSafetySystemOperationsDashboard,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  try {
    const [
      dashboard,
      operations,
    ] = await Promise.all([
      dbGetSafetySystemAdminDashboard(),
      dbGetSafetySystemOperationsDashboard(),
    ]);

    console.log(
      "KRISTO_SAFETY_SYSTEM_ADMIN_DASHBOARD",
      {
        viewerUserId:
          auth.viewer.userId,
        counts: dashboard.counts,
      }
    );

    return NextResponse.json({
      ok: true,

      dashboard: {
        ...dashboard,
        operations,
      },
    });
  } catch (error: any) {
    console.error(
      "KRISTO_SAFETY_SYSTEM_ADMIN_DASHBOARD_FAILED",
      {
        viewerUserId:
          auth.viewer.userId,
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
            "Could not load Report Center."
        ),
      },
      {
        status: 500,
      }
    );
  }
}
