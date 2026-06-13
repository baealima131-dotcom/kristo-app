import { NextRequest, NextResponse } from "next/server";
import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { resolveCanDeleteChurchActivityPost } from "@/app/api/_lib/churchActivityDelete";
import {
  buildPostReportModerationSummary,
  clearFeedItemHiddenByReports,
  isFeedItemHiddenByReports,
} from "@/app/api/_lib/feedReportModeration";
import { guard } from "@/app/api/_lib/rbac";
import { getFeedItemById, deleteFeedItemById } from "@/app/api/_lib/store/feedDb";
import { deleteEngagementForPost } from "@/app/api/_lib/store/feedCommentDb";
import {
  dismissPendingReportsForPost,
  listMediaReportQueueForChurch,
  markPendingReportsActionedForPost,
  normalizeFeedReportPostId,
} from "@/app/api/_lib/store/feedReportDb";

export const runtime = "nodejs";

function ok(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function cleanText(raw: unknown, max = 240) {
  return String(raw || "")
    .trim()
    .slice(0, max);
}

async function requireMediaReportsAccess(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = String(ctxOrRes.churchId || "").trim();
  const userId = String(ctxOrRes.viewer?.userId || "").trim();
  if (!churchId || !userId) return err("Unauthorized", 401);

  const access = await evaluateChurchMediaAccess({ churchId, userId });
  if (!access.canOpenMediaScreen) {
    return err("Forbidden", 403);
  }

  return { ctx: ctxOrRes, churchId, userId, access };
}

function enrichQueueRow(
  item: Awaited<ReturnType<typeof listMediaReportQueueForChurch>>[number],
  feedItem: any | null,
  moderation: Awaited<ReturnType<typeof buildPostReportModerationSummary>> | null
) {
  const title = String(
    feedItem?.title || feedItem?.text || feedItem?.mediaName || "Reported post"
  ).trim();
  const posterUri = String(
    feedItem?.posterUri ||
      feedItem?.videoPosterUri ||
      feedItem?.thumbnailUri ||
      feedItem?.thumbnailUrl ||
      ""
  ).trim();
  const videoUrl = String(feedItem?.videoUrl || feedItem?.mediaUri || "").trim();

  return {
    postId: item.postId,
    churchId: item.churchId,
    title,
    posterUri: posterUri || undefined,
    videoUrl: videoUrl || undefined,
    pendingReportCount: item.pendingReportCount,
    uniqueReporterCount: moderation?.uniqueUsers ?? item.uniqueReporterCount,
    uniqueChurchCount: moderation?.uniqueChurches ?? 0,
    primaryReason: moderation?.primaryReason || item.topReasons[0] || "",
    primarySeverity: moderation?.primarySeverity || "unknown",
    severityLabel: moderation?.severityLabel || "Report",
    latestReportAt: item.latestReportAt,
    topReasons: moderation?.topReasons?.length ? moderation.topReasons : item.topReasons,
    reasonBreakdown: moderation?.reasonBreakdown || [],
    autoHideEligible: Boolean(moderation?.autoHideEligible),
    hiddenByReports: item.hiddenByReports,
    reports: item.reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      details: report.details,
      reporterUserId: report.reporterUserId,
      reporterChurchId: report.reporterChurchId,
      createdAt: report.createdAt,
    })),
  };
}

/** GET /api/church/feed/reports */
export async function GET(req: NextRequest) {
  const auth = await requireMediaReportsAccess(req);
  if (auth instanceof NextResponse) return auth;

  const { churchId } = auth;
  const queue = await listMediaReportQueueForChurch(churchId);
  const hiddenByPostId: Record<string, boolean> = {};

  const rows = await Promise.all(
    queue.map(async (item) => {
      const feedItem = await getFeedItemById(item.postId);
      const moderation = await buildPostReportModerationSummary(item.postId);
      const hidden = feedItem ? isFeedItemHiddenByReports(feedItem) : item.hiddenByReports;
      hiddenByPostId[item.postId] = hidden;
      return enrichQueueRow(
        {
          ...item,
          hiddenByReports: hidden,
        },
        feedItem,
        moderation
      );
    })
  );

  console.log("KRISTO_MEDIA_REPORTS_LIST", {
    churchId,
    count: rows.length,
  });

  return ok({ data: { items: rows } });
}

/** POST /api/church/feed/reports { action: "dismiss" | "delete", postId } */
export async function POST(req: NextRequest) {
  const auth = await requireMediaReportsAccess(req);
  if (auth instanceof NextResponse) return auth;

  const { ctx, churchId, userId } = auth;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const action = cleanText(body?.action, 40).toLowerCase();
  const postId = normalizeFeedReportPostId(body?.postId);
  if (!postId) return err("postId is required", 400);
  if (action !== "dismiss" && action !== "delete") {
    return err('action must be "dismiss" or "delete"', 400);
  }

  const feedItem = await getFeedItemById(postId);
  if (!feedItem) return err("Feed item not found", 404);

  const itemChurchId = String(feedItem.churchId || "").trim();
  if (!itemChurchId || itemChurchId !== churchId) {
    return err("Feed item not in your church", 403);
  }

  if (action === "dismiss") {
    const dismissedCount = await dismissPendingReportsForPost({
      postId,
      churchId,
      reviewerUserId: userId,
    });
    const unhidden = await clearFeedItemHiddenByReports(postId);

    console.log("KRISTO_MEDIA_REPORTS_DISMISS", {
      postId,
      churchId,
      reviewerUserId: userId,
      dismissedCount,
      unhidden,
    });

    return ok({
      data: {
        postId,
        action: "dismiss",
        dismissedCount,
        unhidden,
      },
    });
  }

  const viewerRole = ctx.viewer?.role;
  if (
    !(await resolveCanDeleteChurchActivityPost(feedItem, {
      churchId,
      userId,
      role: viewerRole,
    }))
  ) {
    return err("Forbidden", 403);
  }

  const actionedCount = await markPendingReportsActionedForPost({
    postId,
    churchId,
    reviewerUserId: userId,
  });
  const feedDeleted = await deleteFeedItemById(String(feedItem.id || postId));
  await deleteEngagementForPost(postId);
  const deleted = feedDeleted === true;

  console.log("KRISTO_MEDIA_REPORTS_DELETE", {
    postId,
    churchId,
    reviewerUserId: userId,
    actionedCount,
    deleted: deleted === true,
  });

  return ok({
    data: {
      postId,
      action: "delete",
      deleted: deleted === true,
      actionedCount,
    },
  });
}
