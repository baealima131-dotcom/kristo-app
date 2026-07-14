import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard, guardAuth } from "@/app/api/_lib/rbac";
import {
  getReportedPostIdsForUser,
  hasUserReportedPost,
  isFeedReportDatabaseError,
  submitFeedPostReport,
} from "@/app/api/_lib/store/feedReportDb";
import { createModerationEvent } from "@/app/api/_lib/store/moderationEventsDb";
import {
  dbCreateSafetyReport,
  dbFindSafetyReportForReporterSource,
} from "@/app/api/_lib/store/safetyReportDb";
import {
  getProfile,
} from "@/app/api/auth/_lib/profile";

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

    await createModerationEvent({
      eventType: "report_post",
      actorUserId: reporterUserId,
      actorChurchId: ctxOrRes.churchId || "",
      targetPostId: postId,
      reason,
      details,
    }).catch(() => {});

    const reporterProfile =
      await getProfile(
        reporterUserId
      );

    const reporterKristoId =
      String(
        reporterProfile?.userCode || ""
      )
        .trim()
        .toUpperCase();

    if (!reporterKristoId) {
      return json(
        {
          ok: false,
          error:
            "Your KRISTO ID could not be verified.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Preserve one Safety Report Command Code
     * for the same reporter and feed post.
     */
    let safetyReport =
      await dbFindSafetyReportForReporterSource(
        {
          reporterUserId,
          sourceType:
            "church_feed",
          sourceId:
            postId,
        }
      );

    if (!safetyReport) {
      const normalizedReason =
        reason.toLowerCase();

      const priority =
        normalizedReason.includes(
          "child"
        ) ||
        normalizedReason.includes(
          "threat"
        ) ||
        normalizedReason.includes(
          "violence"
        )
          ? "critical"
          : normalizedReason.includes(
                "harassment"
              ) ||
              normalizedReason.includes(
                "hate"
              )
            ? "high"
            : "normal";

      safetyReport =
        await dbCreateSafetyReport({
          reporterUserId,
          reporterKristoId,

          churchId:
            ctxOrRes.churchId || "",

          sourceType:
            "church_feed",

          sourceId:
            postId,

          category:
            reason,

          reason,

          description:
            details ||
            `Feed post report: ${reason}`,

          priority,
        });
    }

    console.log(
      "KRISTO_FEED_SAFETY_REPORT_CREATED",
      {
        postId,
        reportId:
          safetyReport.id,
        reportCode:
          safetyReport.reportCode,
        reporterUserId,
        reporterKristoId,
        duplicate:
          result.duplicate === true,
      }
    );

    return json({
      ok: true,
      alreadyReported:
        result.duplicate === true,
      duplicate:
        result.duplicate === true,
      report: {
        id:
          safetyReport.id,
        reportCode:
          safetyReport.reportCode,
        status:
          safetyReport.status,
        createdAt:
          safetyReport.createdAt,
      },
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
