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
} from "@/app/api/_lib/store/sokoSellerAccessDb";

import {
  dbListAcceptedSokoWorkforceAssignmentsForUser,
} from "@/app/api/_lib/store/sokoWorkforceDb";

import {
  dbDeleteSokoSupplyDraft,
  dbListSokoSupplyOperations,
  dbSaveSokoSupplyOperation,
} from "@/app/api/_lib/store/sokoProductOperationsDb";

export const runtime = "nodejs";
export const dynamic =
  "force-dynamic";
export const revalidate = 0;

type SupplyAccess = {
  sellerUserId: string;

  access:
    | "seller_owner"
    | "supply_worker";
};

async function resolveSupplyAccess(
  viewerUserId: string,
  requestedSellerUserId?: string
): Promise<SupplyAccess> {
  const viewerId =
    String(viewerUserId || "")
      .trim();

  const requested =
    String(
      requestedSellerUserId || ""
    ).trim();

  const sellerAccess =
    await dbGetSokoSellerAccess({
      userId: viewerId,
    });

  if (
    sellerAccess.approved &&
    (
      !requested ||
      requested === viewerId
    )
  ) {
    return {
      sellerUserId: viewerId,
      access: "seller_owner",
    };
  }

  const assignments =
    await dbListAcceptedSokoWorkforceAssignmentsForUser(
      viewerId
    );

  const supplyAssignments =
    assignments.filter(
      (assignment) =>
        assignment.stage ===
          "supply" &&
        assignment.status ===
          "accepted"
    );

  if (requested) {
    const assignment =
      supplyAssignments.find(
        (row) =>
          row.sellerUserId ===
          requested
      );

    if (assignment) {
      return {
        sellerUserId:
          assignment.sellerUserId,

        access:
          "supply_worker",
      };
    }

    throw Object.assign(
      new Error(
        "You do not have Level 01 access for this SOKO store"
      ),
      { status: 403 }
    );
  }

  if (
    supplyAssignments.length === 1
  ) {
    return {
      sellerUserId:
        supplyAssignments[0]
          .sellerUserId,

      access:
        "supply_worker",
    };
  }

  if (
    supplyAssignments.length > 1
  ) {
    throw new Error(
      "Choose which SOKO store workspace to open"
    );
  }

  throw Object.assign(
    new Error(
      "Active SOKO seller or Level 01 worker access is required"
    ),
    { status: 403 }
  );
}

function fail(error: any) {
  return NextResponse.json(
    {
      ok: false,
      error: String(
        error?.message ||
          "SOKO product operation failed"
      ),
    },
    {
      status:
        Number(error?.status) ||
        400,
    }
  );
}

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  try {
    const requestedSellerUserId =
      String(
        req.nextUrl.searchParams.get(
          "sellerUserId"
        ) || ""
      ).trim();

    const access =
      await resolveSupplyAccess(
        auth.viewer.userId,
        requestedSellerUserId
      );

    const operations =
      await dbListSokoSupplyOperations(
        access.sellerUserId
      );

    return NextResponse.json(
      {
        ok: true,

        sellerUserId:
          access.sellerUserId,

        access:
          access.access,

        operations,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
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
    const access =
      await resolveSupplyAccess(
        auth.viewer.userId,
        body?.sellerUserId
      );

    const mode =
      body?.mode ===
      "recommendation"
        ? "recommendation"

        : body?.mode ===
          "verify_purchase"
          ? "verify_purchase"

          : body?.mode ===
            "sent"
            ? "sent"

            : "working";

    const operation =
      await dbSaveSokoSupplyOperation({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        operationId:
          String(
            body?.operationId ||
              ""
          ).trim() ||
          undefined,

        supplierName:
          String(
            body?.supplierName ||
              ""
          ),

        supplierContact:
          String(
            body?.supplierContact ||
              ""
          ),

        productName:
          String(
            body?.productName ||
              ""
          ),

        supplierCode:
          String(
            body?.supplierCode ||
              ""
          ),

        quantity:
          body?.quantity,

        unitCost:
          body?.unitCost,

        notes:
          String(
            body?.notes ||
              ""
          ),

        mode,
      });

    return NextResponse.json({
      ok: true,
      operation,
    });

  } catch (error: any) {
    return fail(error);
  }
}

export async function DELETE(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  const body =
    await req
      .json()
      .catch(() => ({}));

  try {
    const access =
      await resolveSupplyAccess(
        auth.viewer.userId,
        body?.sellerUserId
      );

    const operation =
      await dbDeleteSokoSupplyDraft({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        operationId:
          String(
            body?.operationId || ""
          ).trim(),
      });

    return NextResponse.json({
      ok: true,
      operation,
    });
  } catch (error: any) {
    return fail(error);
  }
}
