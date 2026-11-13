import { NextRequest, NextResponse } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { getFeedItemById } from "@/app/api/_lib/store/feedDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseYouTubeVideoId(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return VIDEO_ID_RE.test(id) ? id : "";
    }
    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return "";
    const id = url.pathname === "/watch"
      ? url.searchParams.get("v") || ""
      : url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || "";
    return VIDEO_ID_RE.test(id) ? id : "";
  } catch {
    return "";
  }
}

/** Returns up to 100 publicly available top-level YouTube comments for a Kristo feed video. */
export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const viewerUserId = String((auth as any)?.viewer?.userId || "").trim();
  const limit = await rateLimit(req, {
    name: "home-feed-youtube-comments",
    limit: 20,
    windowMs: 60 * 60 * 1000,
    key: `home-feed-youtube-comments:${viewerUserId}`,
  });
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "Comments are being requested too often." }, { status: 429 });
  }

  const postId = String(req.nextUrl.searchParams.get("postId") || "").trim();
  if (!/^system-admin-video-youtube-[A-Za-z0-9_-]{11}$/.test(postId)) {
    return NextResponse.json({ ok: false, error: "YouTube video post not found." }, { status: 404 });
  }

  const item: any = await getFeedItemById(postId);
  if (
    !item ||
    item.deleted ||
    String(item.source || "") !== "system-admin-video-link" ||
    String(item.videoDisplayType || item.provider || "").toLowerCase() !== "youtube" ||
    !["public", "global"].includes(String(item.visibility || "").toLowerCase())
  ) {
    return NextResponse.json({ ok: false, error: "YouTube video post not found." }, { status: 404 });
  }

  const videoId = parseYouTubeVideoId(item.videoUrl || item.url);
  if (!videoId) {
    return NextResponse.json({ ok: false, error: "YouTube video link is invalid." }, { status: 422 });
  }

  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  if (!key) {
    return NextResponse.json({ ok: false, error: "YouTube comments are not configured." }, { status: 503 });
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  endpoint.search = new URLSearchParams({
    part: "snippet",
    videoId,
    maxResults: "100",
    order: "relevance",
    textFormat: "plainText",
    key,
  }).toString();

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const providerReason = String(body?.error?.errors?.[0]?.reason || "");
      if (providerReason === "commentsDisabled") {
        return NextResponse.json({ ok: true, comments: [], unavailable: "comments_disabled" });
      }
      if (response.status === 403) {
        return NextResponse.json({ ok: false, error: "YouTube comments are unavailable for this video." }, { status: 422 });
      }
      return NextResponse.json({ ok: false, error: "Could not load YouTube comments right now." }, { status: 502 });
    }

    const rows = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
    const comments = rows.map((row: any) => {
      const comment = row?.snippet?.topLevelComment || {};
      const data = comment?.snippet || {};
      return {
        id: String(comment?.id || row?.id || ""),
        authorName: String(data?.authorDisplayName || "YouTube user").slice(0, 120),
        authorAvatarUrl: String(data?.authorProfileImageUrl || ""),
        text: String(data?.textDisplay || data?.textOriginal || "").slice(0, 5000),
        publishedAt: String(data?.publishedAt || ""),
        likeCount: Math.max(0, Number(data?.likeCount) || 0),
        replyCount: Math.max(0, Number(row?.snippet?.totalReplyCount) || 0),
        source: "youtube",
      };
    }).filter((comment: any) => comment.id && comment.text);

    return NextResponse.json({ ok: true, comments, count: comments.length, limit: 100 });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not load YouTube comments right now." }, { status: 502 });
  }
}
