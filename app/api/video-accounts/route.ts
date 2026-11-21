import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { listFeedItems } from "@/app/api/_lib/store/feedDb";
import { countDiscussionForPostIds, getPostLikeMeta } from "@/app/api/_lib/store/feedCommentDb";
import {
  isVisibleVideoLinkItem,
  normalizeVideoAccountName,
  videoAccountIdentity,
  videoAccountsMatch,
  type VideoAccountIdentity,
} from "@/app/api/_lib/videoAccountKey";

/**
 * Video account overview (YouTube / TikTok / Facebook account behind System Admin video links).
 *
 * READ ONLY: lists feed items and reads like/comment counts. It never writes, upserts or deletes
 * anything (unlike the Home Feed list, which may upsert generated posters).
 *
 * GET /api/video-accounts?key=<account key>&provider=<youtube|tiktok|facebook>&name=<channel name>
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;

function json(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function cleanParam(value: string | null, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function targetIdentity(key: string, provider: string, name: string): VideoAccountIdentity {
  const kind: VideoAccountIdentity["kind"] = key.includes(":name:") ? "name" : "strong";
  return { key, provider: provider || key.split(":")[0] || "video", name, kind };
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const ctx = ctxOrRes as any;
  const viewerUserId = String(ctx?.viewer?.userId || ctx?.viewer?.id || "").trim();

  const url = new URL(req.url);
  const key = cleanParam(url.searchParams.get("key"));
  const provider = cleanParam(url.searchParams.get("provider"), 20).toLowerCase();
  const name = cleanParam(url.searchParams.get("name"), 200);
  if (!key) return json({ ok: false, error: "Akaunti haijatajwa." }, { status: 400 });

  const target = targetIdentity(key, provider, name);
  const matched = (await listFeedItems())
    .filter(isVisibleVideoLinkItem)
    .filter((item: any) => videoAccountsMatch(videoAccountIdentity(item), target))
    .sort((a: any, b: any) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));

  const page = matched.slice(0, MAX_ITEMS);
  const postIds = page.map((item: any) => String(item?.id || "").trim()).filter(Boolean);
  const discussion = await countDiscussionForPostIds(postIds).catch(() => new Map());
  const items = await Promise.all(
    page.map(async (item: any) => {
      const postId = String(item?.id || "").trim();
      const likeMeta = postId
        ? await getPostLikeMeta(String(item?.churchId || ""), postId, viewerUserId).catch(() => ({
            likeCount: 0,
            likedByMe: false,
          }))
        : { likeCount: 0, likedByMe: false };
      const counts = (postId && discussion.get(postId)) || { commentCount: 0, replyCount: 0 };
      return {
        ...item,
        likeCount: likeMeta.likeCount,
        likedByMe: likeMeta.likedByMe,
        commentCount: counts.commentCount,
        replyCount: counts.replyCount,
      };
    })
  );

  // Account header from its posts: newest name, and the newest saved avatar if any.
  const withAvatar = matched.find((item: any) => String(item?.creatorAvatarUrl || "").trim());
  const newest = matched[0];
  const account = {
    key,
    provider: target.provider,
    name: String(newest?.creatorName || name || "").trim(),
    avatarUrl: String(withAvatar?.creatorAvatarUrl || "").trim(),
  };

  console.log("KRISTO_VIDEO_ACCOUNT_OVERVIEW", {
    key,
    provider: account.provider,
    nameKey: normalizeVideoAccountName(account.name),
    videoCount: matched.length,
    returned: items.length,
  });

  return json({ ok: true, account, videoCount: matched.length, items });
}
