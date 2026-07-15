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
  dbGetSafetyAutoWorkSetting,
  dbSetSafetyAutoWorkSetting,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const enabled =
      await dbGetSafetyAutoWorkSetting();

    return NextResponse.json({
      ok: true,
      enabled,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
          "Could not load Auto Work."
        ),
      },
      {
        status: 500,
      }
    );
  }
}

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
    await req
      .json()
      .catch(() => ({}));

  const enabled =
    body?.enabled === true;

  try {
    const saved =
      await dbSetSafetyAutoWorkSetting({
        enabled,

        updatedByUserId:
          auth.viewer.userId,
      });

    console.log(
      "KRISTO_SAFETY_AUTO_WORK_SETTING_CHANGED",
      {
        viewerUserId:
          auth.viewer.userId,

        enabled:
          saved,
      }
    );

    return NextResponse.json({
      ok: true,
      enabled: saved,
    });
  } catch (error: any) {
    console.error(
      "KRISTO_SAFETY_AUTO_WORK_SETTING_FAILED",
      {
        viewerUserId:
          auth.viewer.userId,

        error: String(
          error?.message ||
          error
        ),
      }
    );

    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
          "Could not update Auto Work."
        ),
      },
      {
        status: 500,
      }
    );
  }
}
