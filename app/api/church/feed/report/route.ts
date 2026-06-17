import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard, guardAuth } from "@/app/api/_lib/rbac";
import {
  getReportedPostIdsForUser,
  hasUserReportedPost,
  isFeedReportDatabaseError,
  submitFeedPostReport,
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

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const postId = cleanPostId(url.searchParams.get("postId"));
  const postIdsRaw = String(url.searchParams.get("postIds") || "").trim();

  try {
    if (postIdsRaw) {
      const postIds = postIdsRaw
        .split(",")
        .map(cleanPostId)
        .filter(Boolean);
      const reportedPostIds = await getReportedPostIdsForUser(ctxOrRes.viewer.userId, postIds);
      return json({
        ok: true,
        data: { reportedPostIds },
      });
    }

    if (!postId) {
      return json({ ok: false, error: "postId or postIds required" }, { status: 400 });
    }

    const reported = await hasUserReportedPost(ctxOrRes.viewer.userId, postId);
    return json({
      ok: true,
      data: {
        reported,
        alreadyReported: reported,
      },
    });
  } catch (error) {
    if (isFeedReportDatabaseError(error)) {
      return json({ ok: false, error: "Report store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/report] GET failed", error);
    return json({ ok: false, error: "Failed to load report status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const postId = cleanPostId(body?.postId);
  const reason = String(body?.reason || "").trim();
  const details = String(body?.details || "").trim();
  const reporterUserId = String(body?.reporterUserId || ctxOrRes.viewer.userId || "").trim();

  if (!postId) {
    return json({ ok: false, error: "postId required" }, { status: 400 });
  }
  if (!reason) {
    return json({ ok: false, error: "reason required" }, { status: 400 });
  }
  if (reporterUserId !== ctxOrRes.viewer.userId) {
    return json({ ok: false, error: "reporterUserId mismatch" }, { status: 403 });
  }

  try {
    const result = await submitFeedPostReport({
      postId,
      reporterUserId,
      reporterChurchId: ctxOrRes.churchId || "",
      reason,
      details,
    });

    if (result.duplicate) {
      return json({
        ok: true,
        alreadyReported: true,
        duplicate: true,
      });
    }

    return json({
      ok: true,
      alreadyReported: false,
      duplicate: false,
    });
  } catch (error) {
    const message = String((error as any)?.message || error || "");
    if (message.toLowerCase().includes("post not found")) {
      return json({ ok: false, error: "Post not found" }, { status: 404 });
    }
    if (isFeedReportDatabaseError(error)) {
      return json({ ok: false, error: "Report store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/report] POST failed", error);
    return json({ ok: false, error: message || "Report failed" }, { status: 500 });
  }
}
