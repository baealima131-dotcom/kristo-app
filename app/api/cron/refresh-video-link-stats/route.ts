import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { listFeedItems, upsertFeedItem } from "@/app/api/_lib/store/feedDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

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

/** Vercel Cron refreshes public YouTube counters once daily; app counters remain live in Kristo. */
export async function GET(req: Request) {
  if (!String(process.env.CRON_SECRET || "").trim()) {
    return NextResponse.json({ ok: false, error: "Cron is not configured." }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  if (!key) {
    return NextResponse.json({ ok: false, error: "YouTube API is not configured." }, { status: 503 });
  }

  try {
    const nowMs = Date.now();
    const items = (await listFeedItems()).filter((item: any) =>
      String(item?.source || "") === "system-admin-video-link" &&
      String(item?.videoDisplayType || item?.provider || "").toLowerCase() === "youtube" &&
      !item?.deleted
    );

    const refreshItems = items.filter((item: any) => {
      const updated = Date.parse(String(item?.platformStatsUpdatedAt || ""));
      return !Number.isFinite(updated) || nowMs - updated >= REFRESH_AFTER_MS;
    });
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
        for (const item of rows) {
          const previousStats = item?.platformStats ?? item?.stats ?? {};
          const previous = previousStats && typeof previousStats === "object" ? previousStats : {};
          await upsertFeedItem({
            ...item,
            platformStats: {
              views: stats.views ?? safeCount(previous.views),
              likes: stats.likes ?? safeCount(previous.likes),
              comments: stats.comments ?? safeCount(previous.comments),
            },
            platformStatsUpdatedAt: new Date(nowMs).toISOString(),
          } as any);
          refreshed += 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      checked: items.length,
      due: refreshItems.length,
      refreshed,
      failed,
      skipped: Math.max(0, items.length - refreshItems.length),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Video statistics refresh failed." }, { status: 500 });
  }
}
