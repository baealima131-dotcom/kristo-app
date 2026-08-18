import type {
  NextRequest,
} from "next/server";
import {
  NextResponse,
} from "next/server";

import {
  guardPlatformOfflineActivation,
} from "@/app/api/_lib/rbac";
import {
  dbListSokoSellerApplications,
  dbReviewSokoSellerApplication,
} from "@/app/api/_lib/store/sokoSellerAccessDb";

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
    const status =
      req.nextUrl.searchParams.get(
        "status"
      ) || "";
    const applications =
      await dbListSokoSellerApplications(
        status
      );

    return NextResponse.json(
      {
        ok: true,
        applications,
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
            "Could not load seller applications."
        ),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    await req.json().catch(
      () => ({})
    );

  try {
    const application =
      await dbReviewSokoSellerApplication({
        applicationId:
          body?.applicationId,
        actorUserId:
          auth.viewer.userId,
        decision:
          body?.decision,
        notes:
          body?.notes,
      });

    console.log(
      "KRISTO_SOKO_SELLER_APPLICATION_REVIEWED",
      {
        applicationId:
          application.id,
        decision:
          body?.decision,
        actorUserId:
          auth.viewer.userId,
        applicantUserId:
          application.userId,
      }
    );

    return NextResponse.json({
      ok: true,
      application,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not review seller application."
        ),
      },
      { status: 400 }
    );
  }
}
