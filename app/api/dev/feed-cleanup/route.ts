import { NextRequest, NextResponse } from "next/server";
import {
  deleteFeedItemById,
  ensureFeedStoreReady,
  listFeedItems,
  listFeedItemsForChurch,
  type ChurchFeedItem,
} from "../../_lib/store/feedDb";

function sampleRowMeta(item: ChurchFeedItem) {
  return {
    id: item.id,
    churchId: item.churchId,
    createdBy: item.createdBy,
    type: item.type,
    kind: typeof item.kind === "string" ? item.kind : null,
    source: item.source ?? null,
  };
}

function matchesUserScope(item: ChurchFeedItem, userId: string) {
  const uid = String(userId || "").trim();
  if (!uid) return false;

  return (
    String(item.createdBy || "").trim() === uid ||
    String(item.userId || "").trim() === uid ||
    String(item.createdByUserId || "").trim() === uid
  );
}

export async function DELETE(req: NextRequest) {
  // DEV-ONLY: Only allow in non-production or with explicit dev tools flag
  if (process.env.NODE_ENV === "production" && process.env.KRISTO_DEV_TOOLS !== "1") {
    return NextResponse.json(
      { ok: false, error: "Dev-only endpoint" },
      { status: 403 }
    );
  }

  const userId = req.headers.get("x-kristo-user-id");
  const role = req.headers.get("x-kristo-role");
  const churchId = req.headers.get("x-kristo-church-id");

  if (!userId || !role || !churchId) {
    return NextResponse.json(
      { ok: false, error: "Missing required headers" },
      { status: 400 }
    );
  }

  const allowedRoles = ["Pastor", "Admin", "Leader"];
  if (!allowedRoles.includes(role)) {
    return NextResponse.json(
      { ok: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  try {
    await ensureFeedStoreReady();

    const cid = String(churchId || "").trim();
    const churchItems = await listFeedItemsForChurch(cid);
    let mode: "church" | "user" = "church";
    let matchedItems = churchItems;

    console.log("[DevFeedCleanup] church-scoped SELECT", {
      churchId: cid,
      count: churchItems.length,
      sampleIds: churchItems.slice(0, 10).map((item) => item.id),
      sampleRows: churchItems.slice(0, 5).map(sampleRowMeta),
    });

    if (churchItems.length === 0) {
      const allItems = await listFeedItems();
      const userItems = allItems.filter((item) => matchesUserScope(item, userId));
      matchedItems = userItems;
      mode = "user";

      console.log("[DevFeedCleanup] user-scoped fallback SELECT (created_by / payload user)", {
        userId,
        count: userItems.length,
        sampleIds: userItems.slice(0, 10).map((item) => item.id),
        sampleRows: userItems.slice(0, 5).map(sampleRowMeta),
      });
    }

    const sampleIds = matchedItems.slice(0, 10).map((item) => item.id);
    let deleted = 0;

    for (const item of matchedItems) {
      const feedId = String(item.id || "").trim();
      if (!feedId) continue;
      const removed = await deleteFeedItemById(feedId);
      if (removed) deleted += 1;
    }

    console.log("[DevFeedCleanup] deleted feed items", {
      churchId: cid,
      userId,
      role,
      mode,
      deleted,
      sampleIds,
    });

    return NextResponse.json({
      ok: true,
      deleted,
      mode,
      sampleIds,
    });
  } catch (error) {
    console.error("[DevFeedCleanup] Error", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
