import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { listFeedItems, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import { facebookGraphCredentialsFromEnv, fetchFacebookGraphVideoStats } from "@/lib/facebookGraphVideoStats";
import { fetchYouTubePublicComments } from "@/lib/youtubePublicComments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;
const FACEBOOK_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_MAX_VIDEOS_PER_RUN = 200;
const YOUTUBE_COMMENT_FETCH_CONCURRENCY = 10;
const YOUTUBE_COMMENT_TIME_BUDGET_MS = 120_000;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FACEBOOK_ITEM_PREFIX = "system-admin-video-facebook-";
const FACEBOOK_VIDEO_ID = /^\d{5,25}$/;
// Each Facebook video costs 3-4 Graph calls; keep a run well inside Meta's app rate limit and
// stop early so the function never runs into its time limit (the rest wait for the next run).
const FACEBOOK_MAX_PER_RUN = 40;
const FACEBOOK_TIME_BUDGET_MS = 120_000;
const FACEBOOK_GRAPH_TIMEOUT_MS = 6000;

function isAuthorized(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.get("authorization") || ""));
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseYouTubeId(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return YOUTUBE_VIDEO_ID.test(id) ? id : "";
    }
    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return "";
    const id = url.pathname === "/watch"
      ? url.searchParams.get("v") || ""
      : url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || "";
    return YOUTUBE_VIDEO_ID.test(id) ? id : "";
  } catch {
    return "";
  }
}

function youtubeVideoIdForItem(item: any): string {
  const postId = String(item?.id || "").trim();
  const canonicalId =
    postId.match(/^system-admin-video-youtube-([A-Za-z0-9_-]{11})$/)?.[1] || "";
  return canonicalId || parseYouTubeId(item?.videoUrl || item?.url);
}

function safeCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

async function loadStats(videoIds: string[], key: string) {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "statistics");
  endpoint.searchParams.set("id", videoIds.join(","));
  endpoint.searchParams.set("key", key);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.items)) {
    throw new Error("YouTube statistics request failed.");
  }

  const stats = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
  for (const row of body.items) {
    const id = String(row?.id || "");
    if (!YOUTUBE_VIDEO_ID.test(id)) continue;
    const values = row?.statistics || {};
    stats.set(id, {
      views: safeCount(values.viewCount),
      likes: safeCount(values.likeCount),
      comments: safeCount(values.commentCount),
    });
  }
  return stats;
}

function isDue(item: any, nowMs: number, intervalMs = REFRESH_AFTER_MS) {
  const updated = Date.parse(String(item?.platformStatsUpdatedAt || ""));
  return !Number.isFinite(updated) || nowMs - updated >= intervalMs;
}

function isCommentsDue(item: any, nowMs: number) {
  const updated = Date.parse(String(item?.platformCommentsUpdatedAt || ""));
  return !Number.isFinite(updated) || nowMs - updated >= REFRESH_AFTER_MS;
}

function lastDueUpdate(item: any) {
  const statsAt = Date.parse(String(item?.platformStatsUpdatedAt || ""));
  const commentsAt = Date.parse(String(item?.platformCommentsUpdatedAt || ""));
  const dueTimes = [
    Number.isFinite(statsAt) ? statsAt : 0,
    Number.isFinite(commentsAt) ? commentsAt : 0,
  ];
  return Math.min(...dueTimes);
}

function previousStatsOf(item: any): Record<string, unknown> {
  const previousStats = item?.platformStats ?? item?.stats ?? {};
  return previousStats && typeof previousStats === "object" ? previousStats : {};
}

async function refreshYouTube(items: any[], key: string, nowMs: number) {
  const allDueItems = items
    .filter((item) => isDue(item, nowMs) || isCommentsDue(item, nowMs))
    .sort((a, b) => lastDueUpdate(a) - lastDueUpdate(b));
  const dueItems = allDueItems.slice(0, YOUTUBE_MAX_VIDEOS_PER_RUN);
  const byVideo = new Map<string, any[]>();
  for (const item of dueItems) {
    const videoId = youtubeVideoIdForItem(item);
    if (!videoId) continue;
    const rows = byVideo.get(videoId) || [];
    rows.push(item);
    byVideo.set(videoId, rows);
  }

  let refreshed = 0;
  let failed = 0;
  let commentsRefreshed = 0;
  let commentsDisabled = 0;
  let commentsFailed = 0;
  const videoIds = [...byVideo.keys()];
  const commentStartedAt = Date.now();

  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const batch = videoIds.slice(offset, offset + 50);
    const statsVideoIds = batch.filter((videoId) =>
      (byVideo.get(videoId) || []).some((item) => isDue(item, nowMs))
    );
    const commentsVideoIds = batch.filter((videoId) =>
      (byVideo.get(videoId) || []).some((item) => isCommentsDue(item, nowMs))
    );

    const statsById = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
    if (statsVideoIds.length) {
      try {
        const result = await loadStats(statsVideoIds, key);
        for (const [id, stats] of result) statsById.set(id, stats);
      } catch {
        failed += statsVideoIds.length;
      }
    }

    const commentsById = new Map<string, { comments: Awaited<ReturnType<typeof fetchYouTubePublicComments>>["comments"]; commentsDisabled: boolean }>();
    for (let commentOffset = 0; commentOffset < commentsVideoIds.length; commentOffset += YOUTUBE_COMMENT_FETCH_CONCURRENCY) {
      if (Date.now() - commentStartedAt >= YOUTUBE_COMMENT_TIME_BUDGET_MS) break;
      const commentBatch = commentsVideoIds.slice(
        commentOffset,
        commentOffset + YOUTUBE_COMMENT_FETCH_CONCURRENCY
      );
      const results = await Promise.all(commentBatch.map(async (videoId) => {
        try {
          return [videoId, await fetchYouTubePublicComments(videoId, key)] as const;
        } catch {
          return [videoId, null] as const;
        }
      }));
      for (const [videoId, result] of results) {
        if (result) commentsById.set(videoId, result);
        else commentsFailed += 1;
      }
    }

    for (const videoId of batch) {
      const stats = statsById.get(videoId);
      const commentResult = commentsById.get(videoId);
      const rows = byVideo.get(videoId) || [];
      if (stats) {
        const hiddenFields = (["likes", "comments"] as const).filter((field) => stats[field] === null);
        for (const item of rows) {
          const previous = previousStatsOf(item);
          const update: any = {
            ...item,
            platformStats: {
              views: stats.views ?? safeCount(previous.views),
              likes: stats.likes,
              comments: stats.comments,
            },
            platformHiddenFields: hiddenFields,
            platformStatsUpdatedAt: new Date(nowMs).toISOString(),
          };
          if (commentResult && isCommentsDue(item, nowMs)) {
            update.platformComments = commentResult.comments;
            update.platformCommentsDisabled = commentResult.commentsDisabled;
            update.platformCommentsUpdatedAt = new Date(nowMs).toISOString();
            commentsRefreshed += 1;
            if (commentResult.commentsDisabled) commentsDisabled += 1;
          }
          await upsertFeedItem(update);
          refreshed += 1;
        }
      } else if (commentResult) {
        for (const item of rows) {
          if (!isCommentsDue(item, nowMs)) continue;
          await upsertFeedItem({
            ...item,
            platformComments: commentResult.comments,
            platformCommentsDisabled: commentResult.commentsDisabled,
            platformCommentsUpdatedAt: new Date(nowMs).toISOString(),
          } as any);
          commentsRefreshed += 1;
          if (commentResult.commentsDisabled) commentsDisabled += 1;
        }
      }
    }
  }
  return {
    checked: items.length,
    due: allDueItems.length,
    processed: dueItems.length,
    refreshed,
    failed,
    commentsRefreshed,
    commentsDisabled,
    commentsFailed,
    commentsDeferred: Math.max(0, allDueItems.length - dueItems.length),
  };
}

/**
 * Facebook counts come from the Graph API only when the app's access allows it. A video whose
 * counts are refused keeps its previous values (or stays empty) and is still marked as checked,
 * so it is retried the next day rather than on every run.
 */
async function refreshFacebook(items: any[], nowMs: number) {
  const credentials = facebookGraphCredentialsFromEnv();
  const videoIdOf = (item: any) => {
    const id = String(item?.id || "");
    const videoId = id.startsWith(FACEBOOK_ITEM_PREFIX) ? id.slice(FACEBOOK_ITEM_PREFIX.length) : "";
    return FACEBOOK_VIDEO_ID.test(videoId) ? videoId : "";
  };
  const due = items.filter((item) => isDue(item, nowMs, FACEBOOK_REFRESH_AFTER_MS) && videoIdOf(item));
  if (!credentials) return { configured: false, checked: items.length, due: due.length, refreshed: 0, unavailable: 0 };

  const startedMs = Date.now();
  let refreshed = 0;
  let unavailable = 0;
  for (const item of due.slice(0, FACEBOOK_MAX_PER_RUN)) {
    if (Date.now() - startedMs > FACEBOOK_TIME_BUDGET_MS) break;
    const stats = await fetchFacebookGraphVideoStats(videoIdOf(item), {
      credentials,
      timeoutMs: FACEBOOK_GRAPH_TIMEOUT_MS,
    });
    const previous = previousStatsOf(item);
    const likes = stats.likes ?? safeCount(previous.likes);
    const comments = stats.comments ?? safeCount(previous.comments);
    if (stats.likes === null && stats.comments === null) unavailable += 1;
    else refreshed += 1;
    await upsertFeedItem({
      ...item,
      ...(stats.publishedAt ? { publishedAt: stats.publishedAt } : {}),
      platformStats: { views: null, likes, comments },
      platformStatsUpdatedAt: new Date(nowMs).toISOString(),
    } as any);
  }
  return { configured: true, checked: items.length, due: due.length, refreshed, unavailable };
}

/** Vercel Cron refreshes public YouTube/Facebook counters once daily; app counters remain live in Kristo. */
export async function GET(req: Request) {
  if (!String(process.env.CRON_SECRET || "").trim()) {
    return NextResponse.json({ ok: false, error: "Cron is not configured." }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  const facebookConfigured = facebookGraphCredentialsFromEnv() !== null;
  if (!key && !facebookConfigured) {
    return NextResponse.json({ ok: false, error: "No video statistics API is configured." }, { status: 503 });
  }

  try {
    const nowMs = Date.now();
    const links = (await listFeedItems()).filter((item: any) =>
      String(item?.source || "") === "system-admin-video-link" && !item?.deleted
    );
    const providerOf = (item: any) => String(item?.videoDisplayType || item?.provider || "").toLowerCase();

    const youtube = key
      ? await refreshYouTube(links.filter((item: any) => providerOf(item) === "youtube"), key, nowMs)
      : null;
    const facebook = await refreshFacebook(links.filter((item: any) => providerOf(item) === "facebook"), nowMs);

    return NextResponse.json({
      ok: true,
      // Top-level fields keep the previous YouTube-only response shape.
      checked: youtube?.checked ?? 0,
      due: youtube?.due ?? 0,
      refreshed: youtube?.refreshed ?? 0,
      failed: youtube?.failed ?? 0,
      commentsRefreshed: youtube?.commentsRefreshed ?? 0,
      commentsDisabled: youtube?.commentsDisabled ?? 0,
      commentsFailed: youtube?.commentsFailed ?? 0,
      commentsDeferred: youtube?.commentsDeferred ?? 0,
      skipped: youtube ? Math.max(0, youtube.checked - youtube.due) : 0,
      youtubeConfigured: Boolean(key),
      facebook,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Video statistics refresh failed." }, { status: 500 });
  }
}
