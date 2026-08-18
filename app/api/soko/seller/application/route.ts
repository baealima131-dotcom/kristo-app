import type {
  NextRequest,
} from "next/server";
import {
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";
import {
  dbGetMySokoSellerApplication,
  dbSubmitSokoSellerApplication,
} from "@/app/api/_lib/store/sokoSellerAccessDb";
import {
  getProfile,
} from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const application =
      await dbGetMySokoSellerApplication(
        auth.viewer.userId
      );

    return NextResponse.json(
      {
        ok: true,
        application,
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
            "Could not load your seller application."
        ),
      },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const body =
    await req.json().catch(
      () => ({})
    );

  try {
    const profile =
      await getProfile(
        auth.viewer.userId
      );

    const kristoId = String(
      profile?.userCode || ""
    )
      .trim()
      .toUpperCase();

    if (!profile || !kristoId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Complete your Kristo profile and Kristo ID before applying to sell.",
        },
        { status: 409 }
      );
    }

    const application =
      await dbSubmitSokoSellerApplication({
        userId:
          auth.viewer.userId,
        kristoId,
        displayName:
          profile.fullName ||
          auth.viewer.name ||
          "Kristo Member",
        email:
          profile.email,
        phone:
          profile.phone,
        businessName:
          body?.businessName,
        category:
          body?.category,
        location:
          body?.location,
        reason:
          body?.reason,
      });

    console.log(
      "KRISTO_SOKO_SELLER_APPLICATION_SUBMITTED",
      {
        applicationId:
          application.id,
        userId:
          application.userId,
        kristoId:
          application.kristoId,
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
            "Could not submit seller application."
        ),
      },
      { status: 400 }
    );
  }
}
