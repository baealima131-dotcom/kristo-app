import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { listFeedItems, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import { getYoutubeChannelConnections } from "@/app/api/_lib/store/youtubeChannelOAuthDb";

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

async function refreshYoutubeAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const body: any = await response.json().catch(() => null);
  return response.ok && body?.access_token ? String(body.access_token) : null;
}

async function loadYoutubeAnalyticsStats(accessToken: string, videoId: string, startDate: string, endDate: string): Promise<{ shares: number; playlistAdds: number } | null> {
  const endpoint = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  endpoint.searchParams.set("ids", "channel==MINE");
  endpoint.searchParams.set("startDate", startDate);
  endpoint.searchParams.set("endDate", endDate);
  endpoint.searchParams.set("metrics", "shares,videosAddedToPlaylists");
  endpoint.searchParams.set("dimensions", "video");
  endpoint.searchParams.set("filters", "video==" + videoId);
  const response = await fetch(endpoint, {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.rows) || !body.rows.length) return null;
  return { shares: safeCount(body.rows[0][1]) ?? 0, playlistAdds: safeCount(body.rows[0][2]) ?? 0 };
}

function analyticsStartDate(value: unknown): string {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "2008-01-01";
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
    const youtubeAnalyticsByItemId = new Map<string, { shares: number; playlistAdds: number }>();
    try {
      const connections = await getYoutubeChannelConnections();
      const oauthByChannel = new Map<string, string>();
      for (const connection of connections) {
        const channelItems = refreshItems.filter((item: any) => String(item?.creatorId || "") === connection.channelId && parseYouTubeId(item?.videoUrl || item?.url));
        if (!channelItems.length) continue;
        const accessToken = await refreshYoutubeAccessToken(connection.refreshToken);
        if (accessToken) oauthByChannel.set(connection.channelId, accessToken);
      }
      for (let offset = 0; offset < refreshItems.length; offset += 5) {
        const batch = refreshItems.slice(offset, offset + 5);
        await Promise.all(batch.map(async (item: any) => {
          const accessToken = oauthByChannel.get(String(item?.creatorId || ""));
          const videoId = parseYouTubeId(item?.videoUrl || item?.url);
          if (!accessToken || !videoId) return;
          try {
            const analytics = await loadYoutubeAnalyticsStats(accessToken, videoId, analyticsStartDate(item?.publishedAt), new Date(nowMs).toISOString().slice(0, 10));
            if (analytics) youtubeAnalyticsByItemId.set(String(item?.id || ""), analytics);
          } catch {
            // Public counters still refresh if channel analytics is unavailable for this video.
          }
        }));
      }
    } catch {
      // OAuth connections are optional; public YouTube counters continue to refresh.
    }

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
              ...(youtubeAnalyticsByItemId.has(String(item?.id || ""))
                ? {
                    shares: youtubeAnalyticsByItemId.get(String(item?.id || ""))!.shares,
                    playlistAdds: youtubeAnalyticsByItemId.get(String(item?.id || ""))!.playlistAdds,
                  }
                : {
                    ...(safeCount(previous.shares) !== null ? { shares: safeCount(previous.shares) } : {}),
                    ...(safeCount(previous.playlistAdds) !== null ? { playlistAdds: safeCount(previous.playlistAdds) } : {}),
                  }),
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
