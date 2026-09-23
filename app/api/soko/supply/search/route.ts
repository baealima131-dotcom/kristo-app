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
  dbListSokoSourcingTasks,
} from "@/app/api/_lib/store/sokoSourcingSmartDb";

import {
  searchSokoSupplyProvider,
  type SokoSupplyProvider,
} from "@/app/api/_lib/store/sokoSupplyConnectors";

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
        "Live supply search failed."
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
    const sellerUserId =
      String(
        req.nextUrl.searchParams.get(
          "sellerUserId"
        ) || ""
      ).trim();

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        sellerUserId
      );

    const taskId =
      String(
        req.nextUrl.searchParams.get(
          "taskId"
        ) || ""
      ).trim();

    const provider =
      String(
        req.nextUrl.searchParams.get(
          "provider"
        ) || "alibaba"
      ).trim() as
        SokoSupplyProvider;

    let query =
      String(
        req.nextUrl.searchParams.get(
          "query"
        ) || ""
      ).trim();

    let category =
      String(
        req.nextUrl.searchParams.get(
          "category"
        ) || ""
      ).trim();

    let quantity =
      Number(
        req.nextUrl.searchParams.get(
          "quantity"
        ) || 0
      );

    let targetUnitCost =
      Number(
        req.nextUrl.searchParams.get(
          "targetUnitCost"
        ) || 0
      );

    if (taskId) {
      const tasks =
        await dbListSokoSourcingTasks(
          access.sellerUserId
        );

      const task =
        tasks.find(
          (row) =>
            row.id ===
            taskId
        );

      if (!task) {
        throw Object.assign(
          new Error(
            "Sourcing task not found."
          ),
          {
            status: 404,
          }
        );
      }

      query =
        task.productName;

      category =
        task.category;

      quantity =
        task.targetQuantity;

      targetUnitCost =
        task.targetUnitCost;
    }

    const result =
      await searchSokoSupplyProvider({
        provider,

        query,

        category,

        quantity,

        targetUnitCost,
      });

    return NextResponse.json(
      {
        ok: true,

        sellerUserId:
          access.sellerUserId,

        ...result,
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
