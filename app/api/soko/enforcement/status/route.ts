import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  dbGetSokoEnforcementStatus,
} from "@/app/api/_lib/store/sokoSafetyDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  req: NextRequest
) {
  const body =
    await req.json().catch(
      () => ({})
    );

  const productIds =
    Array.isArray(body?.productIds)
      ? body.productIds
      : [];

  const sellerUserIds =
    Array.isArray(
      body?.sellerUserIds
    )
      ? body.sellerUserIds
      : [];

  if (
    productIds.length > 200 ||
    sellerUserIds.length > 200
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Too many SOKO status targets.",
      },
      { status: 400 }
    );
  }

  try {
    const status =
      await dbGetSokoEnforcementStatus({
        productIds,
        sellerUserIds,
      });

    return NextResponse.json(
      {
        ok: true,
        ...status,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=15, stale-while-revalidate=30",
        },
      }
    );
  } catch (error: any) {
    console.error(
      "KRISTO_SOKO_ENFORCEMENT_STATUS_FAILED",
      {
        error: String(
          error?.message || error
        ),
      }
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not load SOKO marketplace status.",
      },
      { status: 500 }
    );
  }
}
