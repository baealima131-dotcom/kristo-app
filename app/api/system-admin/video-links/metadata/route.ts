import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "youtube" | "tiktok";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseVideoUrl(raw: unknown): { provider: Provider; url: URL; videoId: string } | null {
  const value = String(raw || "").trim();
  if (!value || value.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    let videoId = "";
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
    else {
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      videoId = match?.[1] || "";
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return { provider: "youtube", url: new URL(`https://www.youtube.com/watch?v=${videoId}`), videoId };
  }

  if (host === "tiktok.com" || host === "m.tiktok.com") {
    const match = url.pathname.match(/^\/@[A-Za-z0-9._-]+\/video\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return { provider: "tiktok", url: new URL(`https://www.tiktok.com${url.pathname}`), videoId: match[1] };
  }
  return null;
}

function safeCount(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

async function fetchJson(url: URL, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function youtubeMetadata(videoId: string) {
  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  if (!key) throw Object.assign(new Error("YouTube metadata is not configured on the server."), { status: 503 });

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.search = new URLSearchParams({
    part: "snippet,statistics",
    id: videoId,
    key,
  }).toString();

  const { response, body } = await fetchJson(endpoint);
  if (!response.ok) {
    if (response.status === 403) {
      throw Object.assign(new Error("YouTube API imekataa ombi. Hakiki API key, API restrictions au quota."), { status: 503 });
    }
    throw Object.assign(new Error("YouTube metadata could not be loaded right now."), { status: 502 });
  }

  const item = Array.isArray(body?.items) ? body.items[0] : null;
  if (!item) throw Object.assign(new Error("No public YouTube video was found at that link."), { status: 404 });

  const snippet = item.snippet || {};
  const statistics = item.statistics || {};
  const channelId = String(snippet.channelId || "");
  let creatorAvatarUrl: string | null = null;

  if (channelId) {
    const channelsUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelsUrl.search = new URLSearchParams({
      part: "snippet",
      id: channelId,
      key,
    }).toString();
    try {
      const channelResult = await fetchJson(channelsUrl, 6000);
      const channel = channelResult.body?.items?.[0];
      creatorAvatarUrl =
        channel?.snippet?.thumbnails?.high?.url ||
        channel?.snippet?.thumbnails?.medium?.url ||
        channel?.snippet?.thumbnails?.default?.url ||
        null;
    } catch {
      // Video metadata remains useful when the optional channel image is unavailable.
    }
  }

  return {
    provider: "youtube" as const,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: String(snippet.title || ""),
    creatorName: String(snippet.channelTitle || ""),
    creatorProfileUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : null,
    creatorAvatarUrl,
    thumbnailUrl:
      item?.snippet?.thumbnails?.high?.url ||
      item?.snippet?.thumbnails?.medium?.url ||
      item?.snippet?.thumbnails?.default?.url ||
      null,
    publishedAt: snippet.publishedAt ? String(snippet.publishedAt) : null,
    stats: {
      views: safeCount(statistics.viewCount),
      likes: safeCount(statistics.likeCount),
      comments: safeCount(statistics.commentCount),
    },
  };
}

async function tiktokMetadata(url: URL, videoId: string) {
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", url.toString());
  const { response, body } = await fetchJson(endpoint);
  if (!response.ok || !body || typeof body !== "object") {
    throw Object.assign(new Error("TikTok could not provide details for this public video link."), { status: 422 });
  }

  return {
    provider: "tiktok" as const,
    videoId,
    url: url.toString(),
    title: String(body.title || ""),
    creatorName: String(body.author_name || ""),
    creatorProfileUrl: typeof body.author_url === "string" ? body.author_url : null,
    creatorAvatarUrl: null,
    thumbnailUrl: typeof body.thumbnail_url === "string" ? body.thumbnail_url : null,
    publishedAt: null,
    stats: { views: null, likes: null, comments: null },
    unavailableFields: ["publishedAt", "views", "likes", "comments"],
  };
}

export async function POST(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  const limit = await rateLimit(req, {
    name: "system-admin-video-metadata",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    key: `system-admin-video-metadata:${auth.viewer.userId}`,
  });
  if (!limit.allowed) {
    return json({ ok: false, error: "Too many lookups. Try again later." }, 429);
  }

  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return json({ ok: false, error: "Request is too large." }, 413);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const parsed = parseVideoUrl(body?.url);
  if (!parsed) {
    return json({ ok: false, error: "Paste a valid public YouTube or TikTok video link." }, 400);
  }

  try {
    const metadata =
      parsed.provider === "youtube"
        ? await youtubeMetadata(parsed.videoId)
        : await tiktokMetadata(parsed.url, parsed.videoId);
    return json({ ok: true, metadata });
  } catch (error: any) {
    const status = Number(error?.status) || 502;
    return json(
      {
        ok: false,
        error: String(error?.message || "Video details could not be loaded."),
      },
      status >= 400 && status <= 599 ? status : 502
    );
  }
}
