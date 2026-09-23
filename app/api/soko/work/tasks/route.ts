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
  dbApproveSokoPurchaseRecommendation,
  dbMarkSokoPurchasePurchased,
  dbCreateSokoSourcingTask,
  dbDeleteSokoSourcingTask,
  dbListSokoSourcingTasks,
  dbUpdateSokoSourcingTask,
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
          "Could not manage sourcing tasks"
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

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        requestedSellerUserId
      );

    const tasks =
      await dbListSokoSourcingTasks(
        access.sellerUserId
      );

    return NextResponse.json({
      ok: true,

      sellerUserId:
        access.sellerUserId,

      access:
        access.access,

      categories:
        SOKO_SOURCING_CATEGORIES,

      tasks,
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
      await requireSokoSellerOwner(
        auth.viewer.userId
      );

    // Prevent accidental duplicate open sourcing tasks.
    const requestedProductName =
      String(
        body?.productName ||
          ""
      ).trim();

    const requestedCategory =
      String(
        body?.category ||
          ""
      ).trim();

    const normalizeTaskText = (
      value: unknown
    ) =>
      String(
        value ?? ""
      )
        .trim()
        .toLowerCase()
        .replace(
          /\s+/g,
          " "
        );

    const existingTasks =
      await dbListSokoSourcingTasks(
        access.sellerUserId
      );

    const existingOpenTask =
      existingTasks.find(
        (row) =>
          row.currentStage ===
            "supply" &&

          (
            row.supplyStatus ===
              "working" ||
            row.supplyStatus ===
              "returned"
          ) &&

          normalizeTaskText(
            row.productName
          ) ===
            normalizeTaskText(
              requestedProductName
            ) &&

          normalizeTaskText(
            row.category
          ) ===
            normalizeTaskText(
              requestedCategory
            )
      );

    if (existingOpenTask) {
      return NextResponse.json({
        ok: true,

        duplicate: true,

        reused: true,

        message:
          "An open sourcing task for this product already exists.",

        task:
          existingOpenTask,
      });
    }

    const task =
      await dbCreateSokoSourcingTask({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        productName:
          String(
            body?.productName ||
              ""
          ),

        category:
          String(
            body?.category ||
              ""
          ),

        targetQuantity:
          Number(
            body?.targetQuantity ||
              0
          ),

        targetUnitCost:
          Number(
            body?.targetUnitCost ||
              0
          ),

        priority:
          body?.priority,

        neededBy:
          String(
            body?.neededBy ||
              ""
          ),

        taskNotes:
          String(
            body?.taskNotes ||
              ""
          ),

        purchaseMode:
          body?.purchaseMode ===
          "already_purchased"
            ? "already_purchased"
            : "to_be_purchased",

        purchaseSupplierName:
          String(
            body?.purchaseSupplierName ||
              ""
          ),

        actualUnitCost:
          Number(
            body?.actualUnitCost ||
              0
          ),

        totalPaid:
          Number(
            body?.totalPaid ||
              0
          ),

        purchaseDate:
          String(
            body?.purchaseDate ||
              ""
          ),

        purchaseOrderReference:
          String(
            body?.purchaseOrderReference ||
              ""
          ),

        purchaseTrackingNumber:
          String(
            body?.purchaseTrackingNumber ||
              ""
          ),
      });

    return NextResponse.json({
      ok: true,
      task,
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
    const access =
      await requireSokoSellerOwner(
        auth.viewer.userId
      );

    if (
      body?.action ===
      "approve_purchase"
    ) {
      const task =
        await dbApproveSokoPurchaseRecommendation({
          sellerUserId:
            access.sellerUserId,

          actorUserId:
            auth.viewer.userId,

          taskId:
            String(
              body?.taskId ||
                ""
            ),
        });

      return NextResponse.json({
        ok: true,
        action:
          "approve_purchase",
        task,
      });
    }

    if (
      body?.action ===
      "mark_purchased"
    ) {
      const task =
        await dbMarkSokoPurchasePurchased({
          sellerUserId:
            access.sellerUserId,

          actorUserId:
            auth.viewer.userId,

          taskId:
            String(
              body?.taskId ||
                ""
            ),

          purchaseSupplierName:
            String(
              body?.purchaseSupplierName ||
                ""
            ),

          actualUnitCost:
            body?.actualUnitCost,

          totalPaid:
            body?.totalPaid,

          purchaseDate:
            String(
              body?.purchaseDate ||
                ""
            ),

          purchaseOrderReference:
            String(
              body?.purchaseOrderReference ||
                ""
            ),

          purchaseTrackingNumber:
            String(
              body?.purchaseTrackingNumber ||
                ""
            ),
        });

      return NextResponse.json({
        ok: true,
        action:
          "mark_purchased",
        task,
      });
    }


    const task =
      await dbUpdateSokoSourcingTask({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        taskId:
          String(
            body?.taskId ||
              ""
          ),

        productName:
          String(
            body?.productName ||
              ""
          ),

        category:
          String(
            body?.category ||
              ""
          ),

        targetQuantity:
          Number(
            body?.targetQuantity ||
              0
          ),

        targetUnitCost:
          Number(
            body?.targetUnitCost ||
              0
          ),

        priority:
          body?.priority,

        neededBy:
          String(
            body?.neededBy ||
              ""
          ),

        taskNotes:
          String(
            body?.taskNotes ||
              ""
          ),
      });

    return NextResponse.json({
      ok: true,
      task,
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
      await requireSokoSellerOwner(
        auth.viewer.userId
      );

    const taskId =
      await dbDeleteSokoSourcingTask({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        taskId:
          String(
            body?.taskId ||
              ""
          ),
      });

    return NextResponse.json({
      ok: true,
      deleted: true,
      taskId,
    });
  } catch (error: any) {
    return fail(error);
  }
}
