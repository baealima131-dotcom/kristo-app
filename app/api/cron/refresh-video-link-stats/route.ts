import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { listFeedItems, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import { facebookGraphCredentialsFromEnv, fetchFacebookGraphVideoStats } from "@/lib/facebookGraphVideoStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
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

function safeCount(value: unknown): number | null {
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

function isDue(item: any, nowMs: number) {
  const updated = Date.parse(String(item?.platformStatsUpdatedAt || ""));
  return !Number.isFinite(updated) || nowMs - updated >= REFRESH_AFTER_MS;
}

function previousStatsOf(item: any): Record<string, unknown> {
  const previousStats = item?.platformStats ?? item?.stats ?? {};
  return previousStats && typeof previousStats === "object" ? previousStats : {};
}

async function refreshYouTube(items: any[], key: string, nowMs: number) {
  const refreshItems = items.filter((item) => isDue(item, nowMs));
  const byVideo = new Map<string, any[]>();
  for (const item of refreshItems) {
    const videoId = parseYouTubeId(item?.videoUrl || item?.url);
    if (!videoId) continue;
    const rows = byVideo.get(videoId) || [];
    rows.push(item);
    byVideo.set(videoId, rows);
  }

  let refreshed = 0;
  let failed = 0;
  const videoIds = [...byVideo.keys()];
  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const batch = videoIds.slice(offset, offset + 50);
    let statsById: Awaited<ReturnType<typeof loadStats>>;
    try {
      statsById = await loadStats(batch, key);
    } catch {
      failed += batch.length;
      continue;
    }

    for (const videoId of batch) {
      const stats = statsById.get(videoId);
      const rows = byVideo.get(videoId) || [];
      if (!stats) {
        failed += rows.length;
        continue;
      }
      // YouTube answered without a count: the owner hid likes or turned comments off, so the
      // old number is no longer shown.
      const hiddenFields = (["likes", "comments"] as const).filter((field) => stats[field] === null);
      for (const item of rows) {
        const previous = previousStatsOf(item);
        await upsertFeedItem({
          ...item,
          platformStats: {
            views: stats.views ?? safeCount(previous.views),
            likes: stats.likes,
            comments: stats.comments,
          },
          platformHiddenFields: hiddenFields,
          platformStatsUpdatedAt: new Date(nowMs).toISOString(),
        } as any);
        refreshed += 1;
      }
    }
  }
  return { checked: items.length, due: refreshItems.length, refreshed, failed };
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
  const due = items.filter((item) => isDue(item, nowMs) && videoIdOf(item));
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
      skipped: youtube ? Math.max(0, youtube.checked - youtube.due) : 0,
      youtubeConfigured: Boolean(key),
      facebook,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Video statistics refresh failed." }, { status: 500 });
  }
}
