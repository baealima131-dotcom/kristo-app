import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  dbGetSafetyReportForReporterByCode,
  dbListSafetyReportsForReporter,
} from "@/app/api/_lib/store/safetyReportDb";

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const reporterUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  const reportCode =
    String(
      req.nextUrl.searchParams.get(
        "code"
      ) || ""
    )
      .trim()
      .toUpperCase();

  if (reportCode) {
    const report =
      await dbGetSafetyReportForReporterByCode(
        {
          reporterUserId,
          reportCode,
        }
      );

    /*
     * Return 404 for both:
     * - code does not exist
     * - code belongs to another user
     *
     * This prevents report-code enumeration.
     */
    if (!report) {
      return NextResponse.json(
        {
          ok: false,
          error: "Report not found",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      report,
    });
  }

  const reports =
    await dbListSafetyReportsForReporter(
      reporterUserId,
      100
    );

  return NextResponse.json({
    ok: true,
    reports,
  });
}
