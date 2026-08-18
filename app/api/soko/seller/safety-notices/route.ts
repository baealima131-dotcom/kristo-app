import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guard,
} from "@/app/api/_lib/rbac";

import {
  dbGetSokoSellerNotices,
  dbRespondToSokoSellerNotice,
} from "@/app/api/_lib/store/sokoSafetyDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest
) {
  const ctxOrRes = await guard(req);

  if (
    ctxOrRes instanceof NextResponse
  ) {
    return ctxOrRes;
  }

  try {
    const notices =
      await dbGetSokoSellerNotices(
        String(
          ctxOrRes.viewer.userId || ""
        ).trim()
      );

    return NextResponse.json(
      {
        ok: true,
        notices,
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
            "Could not load seller notices."
        ),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest
) {
  const ctxOrRes = await guard(req);

  if (
    ctxOrRes instanceof NextResponse
  ) {
    return ctxOrRes;
  }

  const body =
    await req.json().catch(
      () => ({})
    );

  try {
    const result =
      await dbRespondToSokoSellerNotice({
        actionId:
          body?.actionId,
        sellerUserId:
          ctxOrRes.viewer.userId,
        response:
          body?.response,
      });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not submit seller response."
        ),
      },
      { status: 400 }
    );
  }
}
