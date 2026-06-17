import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { guard } from "@/app/api/_lib/rbac";
import { deleteFeedItemById, getFeedItemById } from "@/app/api/_lib/store/feedDb";
import {
  dismissFeedReportsForPost,
  isFeedReportDatabaseError,
  listFeedReportQueueForChurch,
} from "@/app/api/_lib/store/feedReportDb";
function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function cleanPostId(raw: unknown) {
  const id = String(raw || "")
    .replace(/__fy_\d+$/g, "")
    .trim();
  if (!id) return "";
  return id.split("__slot_")[0];
}

async function requireMediaReportsAccess(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const access = await evaluateChurchMediaAccess({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
  });

  if (!access.canOpenMediaScreen) {
    return json({ ok: false, error: "Media reports access denied" }, { status: 403 });
  }

  return ctxOrRes;
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await requireMediaReportsAccess(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const items = await listFeedReportQueueForChurch(ctxOrRes.churchId);
    return json({
      ok: true,
      data: { items },
    });
  } catch (error) {
    if (isFeedReportDatabaseError(error)) {
      return json({ ok: false, error: "Report store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/reports] GET failed", error);
    return json({ ok: false, error: "Failed to load media reports" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await requireMediaReportsAccess(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body?.action || "").trim().toLowerCase();
  const postId = cleanPostId(body?.postId);

  if (!postId) {
    return json({ ok: false, error: "postId required" }, { status: 400 });
  }

  const item = await getFeedItemById(postId);
  if (!item) {
    return json({ ok: false, error: "Post not found" }, { status: 404 });
  }

  const itemChurchId = String(item.churchId || "").trim();
  if (itemChurchId && itemChurchId !== ctxOrRes.churchId) {
    return json({ ok: false, error: "Post is outside your church scope" }, { status: 403 });
  }

  try {
    if (action === "dismiss") {
      const dismissed = await dismissFeedReportsForPost(postId);
      return json({
        ok: true,
        data: { postId, dismissed },
      });
    }

    if (action === "delete") {
      await dismissFeedReportsForPost(postId);
      await deleteFeedItemById(postId);
      return json({
        ok: true,
        data: { postId, deleted: true },
      });
    }

    return json({ ok: false, error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    if (isFeedReportDatabaseError(error)) {
      return json({ ok: false, error: "Report store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/reports] POST failed", error);
    return json({ ok: false, error: "Report action failed" }, { status: 500 });
  }
}
