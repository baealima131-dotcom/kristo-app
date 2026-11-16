import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { getFeedItemById, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import { fetchYouTubePublicComments } from "@/lib/youtubePublicComments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMENTS_REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;
const YOUTUBE_ITEM_PREFIX = "system-admin-video-youtube-";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function cachedComments(item: any) {
  return Array.isArray(item?.platformComments) ? item.platformComments : [];
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

  const videoId = String(new URL(req.url).searchParams.get("videoId") || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return json({ ok: false, error: "YouTube video haikutambuliwa." }, 400);
  }

  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  if (!key) return json({ ok: false, error: "Maoni ya YouTube hayajasanidiwa bado." }, 503);

  try {
    const itemId = `${YOUTUBE_ITEM_PREFIX}${videoId}`;
    const item: any = await getFeedItemById(itemId).catch(() => null);
    const updatedAt = Date.parse(String(item?.platformCommentsUpdatedAt || ""));
    const hasFreshSnapshot =
      Number.isFinite(updatedAt) &&
      Date.now() - updatedAt < COMMENTS_REFRESH_AFTER_MS &&
      Array.isArray(item?.platformComments);

    if (hasFreshSnapshot) {
      return json({
        ok: true,
        data: {
          comments: cachedComments(item),
          commentsDisabled: item?.platformCommentsDisabled === true,
          nextPageToken: null,
          cached: true,
        },
      });
    }

    const result = await fetchYouTubePublicComments(videoId, key);
    if (item && String(item?.source || "") === "system-admin-video-link" && !item?.deleted) {
      await upsertFeedItem({
        ...item,
        platformComments: result.comments,
        platformCommentsDisabled: result.commentsDisabled,
        platformCommentsUpdatedAt: new Date().toISOString(),
      } as any);
    }

    return json({
      ok: true,
      data: {
        comments: result.comments,
        commentsDisabled: result.commentsDisabled,
        nextPageToken: null,
        cached: false,
      },
    });
  } catch {
    return json({ ok: false, error: "Maoni ya YouTube hayakuweza kupakiwa sasa." }, 502);
  }
}
