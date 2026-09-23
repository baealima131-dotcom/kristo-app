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
  requireSokoSellerOwner,
  resolveSokoSupplyAccess,
} from "@/app/api/_lib/store/sokoSupplyAccess";

import {
  dbCreateSokoSupplyPurchaseRequest,
  dbListSokoSupplyPurchaseRequests,
  dbSetSokoSupplyPurchaseStatus,
} from "@/app/api/_lib/store/sokoSupplyPurchaseDb";

import {
  dbListSokoSourcingTasks,
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
        "Purchase request failed."
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
        req.nextUrl.searchParams.get(
          "sellerUserId"
        ) || ""
      ).trim();

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        requestedSellerUserId
      );

    const requests =
      await dbListSokoSupplyPurchaseRequests(
        access.sellerUserId
      );

    return NextResponse.json({
      ok: true,

      sellerUserId:
        access.sellerUserId,

      requests,
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
    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        String(
          body?.sellerUserId ||
          ""
        )
      );

    const taskId =
      String(
        body?.taskId ||
        ""
      ).trim();

    const sourcingTasks =
      await dbListSokoSourcingTasks(
        access.sellerUserId
      );

    const sourcingTask =
      sourcingTasks.find(
        (row) =>
          row.id === taskId
      );

    if (!sourcingTask) {
      throw Object.assign(
        new Error(
          "Sourcing task not found."
        ),
        {
          status: 404,
        }
      );
    }

    const request =
      await dbCreateSokoSupplyPurchaseRequest({
        sellerUserId:
          access.sellerUserId,

        taskId,

        taskProductName:
          sourcingTask.productName,

        actorUserId:
          auth.viewer.userId,

        provider:
          String(
            body?.provider ||
            ""
          ),

        providerProductId:
          String(
            body?.providerProductId ||
            ""
          ),

        productName:
          String(
            body?.productName ||
            ""
          ),

        productUrl:
          String(
            body?.productUrl ||
            ""
          ),

        checkoutUrl:
          String(
            body?.checkoutUrl ||
            ""
          ),

        imageUrl:
          String(
            body?.imageUrl ||
            ""
          ),

        supplierName:
          String(
            body?.supplierName ||
            ""
          ),

        currency:
          String(
            body?.currency ||
            "USD"
          ),

        unitPrice:
          Number(
            body?.unitPrice ||
            0
          ),

        quantity:
          Number(
            body?.quantity ||
            0
          ),

        moq:
          Number(
            body?.moq ||
            0
          ),

        purchasePath:
          body?.purchasePath ===
          "needs_quote"
            ? "needs_quote"
            : "ready_to_order",

        shippingEstimate:
          Number(
            body?.shippingEstimate ||
            0
          ),
      });

    return NextResponse.json({
      ok: true,
      request,
    });
  } catch (error: any) {
    return fail(error);
  }
}

export async function PATCH(
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
    const owner =
      await requireSokoSellerOwner(
        auth.viewer.userId
      );

    const action =
      String(
        body?.action || ""
      );

    if (
      action !== "approve" &&
      action !== "reject"
    ) {
      throw new Error(
        "Purchase action must be approve or reject."
      );
    }

    const request =
      await dbSetSokoSupplyPurchaseStatus({
        sellerUserId:
          owner.sellerUserId,

        requestId:
          String(
            body?.requestId ||
            ""
          ),

        status:
          action === "approve"
            ? "approved"
            : "rejected",
      });

    return NextResponse.json({
      ok: true,
      request,
    });
  } catch (error: any) {
    return fail(error);
  }
}
