import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { getActiveMembership } from "@/app/api/_lib/memberships";
import { getFeedItemById } from "@/app/api/_lib/store/feedDb";
import { maybeAutoHideFeedItemByReports } from "@/app/api/_lib/feedReportModeration";
import { notifyContentReportReceived } from "@/app/api/_lib/feedReportNotifications";
import {
  createFeedReport,
  FEED_REPORT_REASONS,
  findFeedReport,
  listReportedPostIdsForUser,
  normalizeFeedReportPostId,
} from "@/app/api/_lib/store/feedReportDb";

export const runtime = "nodejs";

function ok(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function cleanText(raw: unknown, max = 2000) {
  return String(raw || "")
    .trim()
    .slice(0, max);
}

/** GET /api/church/feed/report?postId=... or ?postIds=a,b,c */
export async function GET(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const viewerUserId = String(ctxOrRes.viewer?.userId || "").trim();
  if (!viewerUserId) return err("Unauthorized", 401);

  const postId = normalizeFeedReportPostId(req.nextUrl.searchParams.get("postId"));
  const postIdsRaw = String(req.nextUrl.searchParams.get("postIds") || "").trim();

  if (postId) {
    const existing = await findFeedReport(postId, viewerUserId);
    return ok({
      data: {
        postId,
        reported: Boolean(existing),
        alreadyReported: Boolean(existing),
        report: existing,
      },
    });
  }

  const postIds = postIdsRaw
    ? postIdsRaw
        .split(",")
        .map((id) => normalizeFeedReportPostId(id))
        .filter(Boolean)
    : [];

  const reportedPostIds = await listReportedPostIdsForUser(viewerUserId, postIds);

  return ok({
    data: {
      reportedPostIds,
    },
  });
}

/** POST /api/church/feed/report */
export async function POST(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const viewerUserId = String(ctxOrRes.viewer?.userId || "").trim();
  if (!viewerUserId) return err("Unauthorized", 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const postId = normalizeFeedReportPostId(body?.postId);
  const reason = cleanText(body?.reason, 120);
  const details = cleanText(body?.details, 2000);

  if (!postId) return err("postId is required", 400);
  if (!reason) return err("reason is required", 400);
  if (!FEED_REPORT_REASONS.includes(reason as (typeof FEED_REPORT_REASONS)[number])) {
    return err("Invalid report reason", 400);
  }

  console.log("KRISTO_REPORT_SUBMIT", {
    postId,
    reporterUserId: viewerUserId,
    reason,
  });

  const feedItem = await getFeedItemById(postId);
  if (!feedItem) return err("Feed item not found", 404);

  const reportedUserId = String(
    (feedItem as any)?.createdBy ||
      (feedItem as any)?.authorId ||
      (feedItem as any)?.actorUserId ||
      (feedItem as any)?.postedByUserId ||
      ""
  ).trim();

  const churchId = String((feedItem as any)?.churchId || "").trim();

  const mediaId = String(
    (feedItem as any)?.ownerMediaId || (feedItem as any)?.mediaId || ""
  ).trim();

  const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();
  const activeMembership = await getActiveMembership(viewerUserId);
  const reporterChurchId =
    headerChurchId || String(activeMembership?.churchId || "").trim() || undefined;

  try {
    const result = await createFeedReport({
      postId,
      reporterUserId: viewerUserId,
      reporterChurchId,
      reportedUserId: reportedUserId || undefined,
      churchId: churchId || undefined,
      mediaId: mediaId || undefined,
      reason,
      details: details || undefined,
    });

    if (result.duplicate) {
      console.log("KRISTO_REPORT_DUPLICATE", { postId, reporterUserId: viewerUserId });
      return ok({
        duplicate: true,
        alreadyReported: true,
        data: {
          postId,
          reported: true,
          report: result.record,
        },
      });
    }

    console.log("KRISTO_REPORT_SUCCESS", {
      postId,
      reportId: result.record.id,
      reporterUserId: viewerUserId,
    });

    if (churchId) {
      try {
        const notified = await notifyContentReportReceived({
          churchId,
          reportId: result.record.id,
          postId,
          reporterUserId: viewerUserId,
        });
        console.log("KRISTO_REPORT_NOTIFY_ADMINS", { postId, reportId: result.record.id, notified });
      } catch (notifyError: any) {
        console.log("KRISTO_REPORT_NOTIFY_FAILED", {
          postId,
          reportId: result.record.id,
          message: String(notifyError?.message || notifyError),
        });
      }

      await maybeAutoHideFeedItemByReports({ postId, churchId });
    }

    return ok({
      duplicate: false,
      alreadyReported: false,
      data: {
        postId,
        reported: true,
        report: result.record,
      },
    });
  } catch (error: any) {
    console.log("KRISTO_REPORT_FAILED", {
      postId,
      reporterUserId: viewerUserId,
      message: String(error?.message || error),
    });
    return err(error?.message || "Failed to submit report", 500);
  }
}
