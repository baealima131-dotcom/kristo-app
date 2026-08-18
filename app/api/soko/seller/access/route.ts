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
  dbGetSokoSellerAccess,
  dbRedeemSokoSellerCommandCode,
} from "@/app/api/_lib/store/sokoSellerAccessDb";
import {
  getProfile,
} from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function canonicalIdentity(
  userId: string
) {
  const profile =
    await getProfile(userId);

  return {
    userId,
    kristoId: String(
      profile?.userCode || ""
    )
      .trim()
      .toUpperCase(),
    displayName: String(
      profile?.fullName || "Kristo Member"
    ).trim(),
  };
}

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const identity =
      await canonicalIdentity(
        auth.viewer.userId
      );
    const access =
      await dbGetSokoSellerAccess(
        identity
      );

    return NextResponse.json(
      {
        ok: true,
        access,
        identity,
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
            "Could not load seller access."
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
    const identity =
      await canonicalIdentity(
        auth.viewer.userId
      );

    if (!identity.kristoId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Your Kristo ID could not be resolved.",
        },
        { status: 409 }
      );
    }

    const access =
      await dbRedeemSokoSellerCommandCode({
        userId:
          identity.userId,
        kristoId:
          identity.kristoId,
        commandCode:
          body?.commandCode,
      });

    console.log(
      "KRISTO_SOKO_SELLER_CODE_REDEEMED",
      {
        userId:
          identity.userId,
        kristoId:
          identity.kristoId,
        applicationId:
          access.applicationId,
      }
    );

    return NextResponse.json({
      ok: true,
      access,
      identity,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not activate seller access."
        ),
      },
      { status: 400 }
    );
  }
}
