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

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const userId =
    String(
      auth.viewer.userId || ""
    ).trim();

  const allowed =
    await dbHasSafetyRole(
      userId,
      "Safety_Supervisor"
    );

  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety Supervisor access required",
      },
      {
        status: 403,
      }
    );
  }

  const dashboard =
    await dbGetSafetySupervisorDashboard(
      userId
    );

  return NextResponse.json({
    ok: true,
    dashboard,
  });
}
