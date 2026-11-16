import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const viewerId = String((auth as any)?.viewer?.userId || (auth as any)?.viewer?.id || "u-unknown");
  const limit = await rateLimit(req, {
    name: "youtube-public-comments",
    limit: 60,
    windowMs: 60 * 60 * 1000,
    key: `youtube-public-comments:${viewerId}`,
  });
  if (!limit.allowed) return json({ ok: false, error: "Jaribu tena baada ya muda mfupi." }, 429);

  const url = new URL(req.url);
  const videoId = String(url.searchParams.get("videoId") || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return json({ ok: false, error: "YouTube video haikutambuliwa." }, 400);
  }

  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  if (!key) return json({ ok: false, error: "Maoni ya YouTube hayajasanidiwa bado." }, 503);

  const pageToken = String(url.searchParams.get("pageToken") || "").trim();
  if (pageToken.length > 256) return json({ ok: false, error: "Ukurasa wa maoni si sahihi." }, 400);

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  endpoint.search = new URLSearchParams({
    part: "snippet",
    videoId,
    maxResults: "20",
    order: "relevance",
    textFormat: "plainText",
    key,
    ...(pageToken ? { pageToken } : {}),
  }).toString();

  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(9000) });
    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = String(body?.error?.errors?.[0]?.reason || "");
      if (reason === "commentsDisabled" || reason === "disabledComments") {
        return json({ ok: true, data: { comments: [], commentsDisabled: true, nextPageToken: null } });
      }
      if (response.status === 403) {
        return json({ ok: false, error: "YouTube haikuruhusu kusoma maoni ya video hii." }, 503);
      }
      return json({ ok: false, error: "Maoni ya YouTube hayakuweza kupakiwa sasa." }, 502);
    }

    const comments = (Array.isArray(body?.items) ? body.items : []).flatMap((thread: any) => {
      const comment = thread?.snippet?.topLevelComment;
      const snippet = comment?.snippet;
      const text = String(snippet?.textDisplay || snippet?.textOriginal || "").trim();
      if (!text) return [];
      const image = String(snippet?.authorProfileImageUrl || "").trim();
      const profile = String(snippet?.authorChannelUrl || "").trim();
      return [{
        id: String(comment?.id || ""),
        authorName: String(snippet?.authorDisplayName || "YouTube user").slice(0, 120),
        authorAvatarUrl: /^https:\/\//i.test(image) ? image : "",
        authorChannelUrl: /^https:\/\/(www\.)?youtube\.com\//i.test(profile) ? profile : "",
        text: text.slice(0, 5000),
        publishedAt: String(snippet?.publishedAt || ""),
        likeCount: safeCount(snippet?.likeCount),
        replyCount: safeCount(thread?.snippet?.totalReplyCount),
      }];
    });

    return json({
      ok: true,
      data: {
        comments,
        commentsDisabled: false,
        nextPageToken: typeof body?.nextPageToken === "string" ? body.nextPageToken : null,
      },
    });
  } catch {
    return json({ ok: false, error: "Muunganisho wa maoni ya YouTube haukupatikana." }, 502);
  }
}
