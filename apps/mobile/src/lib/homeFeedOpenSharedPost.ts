import { getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import {
  buildHomeFeedVideoOpenPayload,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";
import { normalizeCommentPostId } from "@/src/lib/homeFeedComments";
import { feedList } from "@/src/lib/homeFeedStore";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import type { SharedContentPayload } from "@/src/lib/messagesStore";

export const PENDING_HOME_FEED_OPEN_TTL_MS = 10_000;

export type PendingHomeFeedOpenRequest = {
  postId: string;
  preferWatch: boolean;
  sharedContent: SharedContentPayload;
  createdAt: number;
};

let pendingOpenRequest: PendingHomeFeedOpenRequest | null = null;

export function isPendingHomeFeedOpenRequestFresh(
  pending: PendingHomeFeedOpenRequest | null,
  now = Date.now()
): boolean {
  if (!pending) return false;
  const createdAt = Number(pending.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  return now - createdAt <= PENDING_HOME_FEED_OPEN_TTL_MS;
}

export function dropStalePendingHomeFeedOpenRequest(now = Date.now()): boolean {
  const pending = pendingOpenRequest;
  if (!pending || isPendingHomeFeedOpenRequestFresh(pending, now)) return false;

  pendingOpenRequest = null;
  console.log("KRISTO_SHARED_POST_OPEN_DROPPED_STALE", {
    postId: pending.postId,
    ageMs: now - Number(pending.createdAt || 0),
  });
  return true;
}

export function queueOpenSharedHomeFeedPost(shared: SharedContentPayload): boolean {
  const postId = normalizeCommentPostId(String(shared.postId || "").trim());
  if (!postId) return false;

  const createdAt = Date.now();
  pendingOpenRequest = {
    postId,
    preferWatch: Boolean(String(shared.videoUri || "").trim()),
    sharedContent: shared,
    createdAt,
  };

  console.log("KRISTO_SHARED_POST_OPEN_QUEUE", {
    postId,
    preferWatch: pendingOpenRequest.preferWatch,
    hasVideoUri: Boolean(String(shared.videoUri || "").trim()),
    createdAt,
  });
  return true;
}

export function peekPendingHomeFeedOpenRequest(): PendingHomeFeedOpenRequest | null {
  return pendingOpenRequest;
}

export function consumePendingHomeFeedOpenRequest(): PendingHomeFeedOpenRequest | null {
  const next = pendingOpenRequest;
  pendingOpenRequest = null;
  return next;
}

export function findHomeFeedRowByPostId(postId: string): any | null {
  const target = normalizeCommentPostId(String(postId || "").trim());
  if (!target) return null;

  const seen = new Set<string>();
  const rows = [...feedList(), ...getCachedHomeFeedBackendRows()];
  for (const row of rows) {
    const id = normalizeCommentPostId(String(row?.id || "").trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === target) return row;
  }
  return null;
}

export function buildSyntheticFeedItemFromSharedContent(shared: SharedContentPayload): any {
  const postId = normalizeCommentPostId(String(shared.postId || "").trim());
  const videoUri = String(shared.videoUri || "").trim();
  const posterUri = String(shared.posterUri || "").trim();
  const title = String(shared.title || shared.caption || "").trim();

  return {
    id: postId,
    title,
    body: title,
    text: title,
    churchName: String(shared.churchName || "").trim(),
    authorName: String(shared.authorName || "").trim(),
    videoUri,
    posterUri,
    videoPosterUri: posterUri,
    thumbnailUri: posterUri,
    mediaType: videoUri ? "video" : "post",
    mediaKind: shared.type || (videoUri ? "video" : "post"),
  };
}

export function buildHomeFeedVideoOpenPayloadFromSharedContent(
  shared: SharedContentPayload
): HomeFeedVideoOpenPayload | null {
  const found = shared.postId ? findHomeFeedRowByPostId(shared.postId) : null;
  const item = found || buildSyntheticFeedItemFromSharedContent(shared);
  const payload = buildHomeFeedVideoOpenPayload(item);
  if (payload) return payload;

  const videoUri = String(resolveVideoUri(item) || shared.videoUri || "").trim();
  const postId = normalizeCommentPostId(String(item?.id || shared.postId || "").trim());
  if (!postId || !videoUri) return null;

  return {
    postId,
    title: String(item?.title || shared.title || shared.caption || "Watch").trim(),
    videoUri,
    posterUri: String(shared.posterUri || item?.posterUri || "").trim() || undefined,
    item,
  };
}

export function resolveSharedPostOpenAction(
  shared: SharedContentPayload,
  visibleRows: any[]
): {
  mode: "watch" | "scroll" | "home";
  payload?: HomeFeedVideoOpenPayload;
  item?: any;
  postId: string;
} {
  const postId = normalizeCommentPostId(String(shared.postId || "").trim());
  if (!postId) return { mode: "home", postId: "" };

  const found =
    findHomeFeedRowByPostId(postId) ||
    visibleRows.find((row) => normalizeCommentPostId(String(row?.id || "")) === postId) ||
    null;
  const item = found || buildSyntheticFeedItemFromSharedContent(shared);
  const watchPayload = buildHomeFeedVideoOpenPayloadFromSharedContent({
    ...shared,
    postId,
  });

  if (watchPayload && (shared.videoUri || resolveVideoUri(item))) {
    return { mode: "watch", payload: watchPayload, item, postId };
  }

  if (found) {
    return { mode: "scroll", item: found, postId };
  }

  return { mode: "home", postId };
}
