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
  resolveSokoSupplyAccess,
} from "@/app/api/_lib/store/sokoSupplyAccess";

import {
  dbCreateSokoSupplier,
  dbListSokoSuppliers,
  SOKO_SOURCING_CATEGORIES,
} from "@/app/api/_lib/store/sokoSourcingSmartDb";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const revalidate =
  0;

function fail(
  error: any
) {
  return NextResponse.json(
    {
      ok: false,

      error: String(
        error?.message ||
          "Could not manage suppliers"
      ),
    },
    {
      status:
        Number(
          error?.status
        ) || 400,
    }
  );
}

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
      NextResponse
  ) {
    return auth;
  }

  try {
    const requestedSellerUserId =
      String(
        req.nextUrl
          .searchParams
          .get(
            "sellerUserId"
          ) || ""
      ).trim();

    const category =
      String(
        req.nextUrl
          .searchParams
          .get(
            "category"
          ) || ""
      ).trim();

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        requestedSellerUserId
      );

    const suppliers =
      await dbListSokoSuppliers({
        sellerUserId:
          access.sellerUserId,

        category,
      });

    return NextResponse.json({
      ok: true,

      sellerUserId:
        access.sellerUserId,

      access:
        access.access,

      categories:
        SOKO_SOURCING_CATEGORIES,

      suppliers,
    });
  } catch (error: any) {
    return fail(error);
  }
}

export async function POST(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
      NextResponse
  ) {
    return auth;
  }

  const body =
    await req
      .json()
      .catch(
        () => ({})
      );

  try {
    /*
     * Seller owner OR accepted Level 01
     * worker may add a reusable supplier.
     */
    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        String(
          body?.sellerUserId ||
            ""
        )
      );

    const supplier =
      await dbCreateSokoSupplier({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        name:
          String(
            body?.name || ""
          ),

        category:
          String(
            body?.category ||
              ""
          ),

        websiteUrl:
          String(
            body?.websiteUrl ||
              ""
          ),

        searchUrlTemplate:
          String(
            body?.searchUrlTemplate ||
              ""
          ),

        availabilityUrlTemplate:
          String(
            body?.availabilityUrlTemplate ||
              ""
          ),

        country:
          String(
            body?.country ||
              ""
          ),

        contact:
          String(
            body?.contact ||
              ""
          ),

        moq:
          Number(
            body?.moq || 0
          ),

        leadTime:
          String(
            body?.leadTime ||
              ""
          ),
      });

    return NextResponse.json({
      ok: true,
      supplier,
    });
  } catch (error: any) {
    return fail(error);
  }
}
