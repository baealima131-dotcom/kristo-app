import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  guardPlatformOfflineActivation,
} from "@/app/api/_lib/rbac";

import {
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
    const dashboard =
      await dbGetSafetySystemOperationsDashboard();

    return NextResponse.json({
      ok: true,
      dashboard,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ??
            "Could not load Operations dashboard."
        ),
      },
      {
        status: 500,
      }
    );
  }
}
