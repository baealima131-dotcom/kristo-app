import { useSyncExternalStore } from "react";
import {
  homeFeedCommentPostId,
  homeFeedScheduleEngagementId,
  readFeedItemLikedByMe,
} from "@/src/components/homeFeed/homeFeedUtils";

export type HomeFeedLikeState = {
  likedByMe: boolean;
  liked: boolean;
  likeCount: number;
};

type ServerLikeSnapshot = { likedByMe: boolean; likeCount: number };

const serverLikeByPostId: Record<string, ServerLikeSnapshot> = {};
const optimisticLikes: Record<string, HomeFeedLikeState> = {};
const optimisticSaved: Record<string, boolean> = {};
const reportedPostIds: Record<string, true> = {};
const commentCountOverrides: Record<string, number> = {};

const postListeners = new Map<string, Set<() => void>>();

function notifyPost(postId: string) {
  const listeners = postListeners.get(postId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

function subscribePost(postId: string, listener: () => void) {
  const cleanId = String(postId || "").trim();
  if (!cleanId) return () => {};
  let listeners = postListeners.get(cleanId);
  if (!listeners) {
    listeners = new Set();
    postListeners.set(cleanId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      postListeners.delete(cleanId);
    }
  };
}

function discussionCountFromItem(item: any) {
  const total = Number(item?.totalDiscussionCount || 0);
  if (total > 0) return total;
  return Number(item?.commentCount || 0) + Number(item?.replyCount || 0);
}

export function resolveHomeFeedLikeState(
  item: any,
  postId = homeFeedScheduleEngagementId(item)
): HomeFeedLikeState {
  if (!postId) {
    return { likedByMe: false, liked: false, likeCount: 0 };
  }

  const itemLikedByMe = readFeedItemLikedByMe(item);
  const hydrated = serverLikeByPostId[postId];
  const serverLikedByMe = hydrated?.likedByMe === true || itemLikedByMe;
  const serverLikeCount = Math.max(
    Number(item?.likeCount || 0),
    Number(hydrated?.likeCount || 0)
  );

  const override = Object.prototype.hasOwnProperty.call(optimisticLikes, postId)
    ? optimisticLikes[postId]
    : undefined;

  let finalLikedByMe = serverLikedByMe;
  if (override) {
    if (serverLikedByMe) {
      finalLikedByMe = true;
    } else if (override.likedByMe === true) {
      finalLikedByMe = true;
    } else {
      finalLikedByMe = false;
    }
  }

  const likeCount = Math.max(
    serverLikeCount,
    override ? Number(override.likeCount || 0) : 0
  );

  return {
    likedByMe: finalLikedByMe,
    liked: finalLikedByMe,
    likeCount,
  };
}

export function resolveHomeFeedSavedState(item: any, postId = String(item?.id || "").trim()) {
  if (postId && Object.prototype.hasOwnProperty.call(optimisticSaved, postId)) {
    return optimisticSaved[postId];
  }
  return Boolean(item?.saved);
}

export function resolveHomeFeedReportedState(
  item: any,
  postId = String(item?.id || "").trim()
) {
  if (postId && reportedPostIds[postId]) return true;
  return false;
}

export function resolveHomeFeedDiscussionCount(
  item: any,
  postId = homeFeedCommentPostId(item)
) {
  const serverCount = discussionCountFromItem(item);
  if (!postId || !Object.prototype.hasOwnProperty.call(commentCountOverrides, postId)) {
    return serverCount;
  }
  return Math.max(serverCount, commentCountOverrides[postId] ?? 0);
}

export function setHomeFeedOptimisticLike(postId: string, state: HomeFeedLikeState) {
  const cleanId = String(postId || "").trim();
  if (!cleanId) return;
  optimisticLikes[cleanId] = state;
  notifyPost(cleanId);
}

export function setHomeFeedOptimisticSaved(postId: string, saved: boolean) {
  const cleanId = String(postId || "").trim();
  if (!cleanId) return;
  optimisticSaved[cleanId] = saved;
  notifyPost(cleanId);
}

export function setHomeFeedReported(postId: string) {
  const cleanId = String(postId || "").trim();
  if (!cleanId) return;
  reportedPostIds[cleanId] = true;
  notifyPost(cleanId);
}

export function setHomeFeedDiscussionCountOverride(postId: string, count: number) {
  const cleanId = String(postId || "").trim();
  if (!cleanId || !Number.isFinite(count)) return;
  commentCountOverrides[cleanId] = Math.max(0, count);
  notifyPost(cleanId);
}

export function bumpHomeFeedDiscussionCountOverride(postId: string, delta: number) {
  const cleanId = String(postId || "").trim();
  if (!cleanId || !Number.isFinite(delta) || delta === 0) return;
  const current = commentCountOverrides[cleanId] ?? 0;
  commentCountOverrides[cleanId] = Math.max(0, current + delta);
  notifyPost(cleanId);
}

/** Apply server like snapshots from poll/refresh; notify only changed posts. */
export function syncHomeFeedEngagementFromServerLikes(
  rows: any[],
  serverLikes: Record<string, ServerLikeSnapshot>
) {
  const changedPostIds = new Set<string>();

  for (const [postId, snapshot] of Object.entries(serverLikes)) {
    const prev = serverLikeByPostId[postId];
    if (
      prev?.likedByMe === snapshot.likedByMe &&
      prev?.likeCount === snapshot.likeCount
    ) {
      continue;
    }
    serverLikeByPostId[postId] = snapshot;
    changedPostIds.add(postId);
  }

  for (const row of rows) {
    const postId = homeFeedScheduleEngagementId(row);
    if (!postId || !(postId in optimisticLikes)) continue;
    const serverLikedByMe = serverLikes[postId]?.likedByMe === true;
    if (serverLikedByMe || optimisticLikes[postId].likedByMe === serverLikedByMe) {
      delete optimisticLikes[postId];
      changedPostIds.add(postId);
    }
  }

  for (const postId of changedPostIds) {
    notifyPost(postId);
  }

  return changedPostIds.size;
}

export function hydrateHomeFeedReportedPostIds(ids: string[]) {
  let changed = false;
  for (const id of ids) {
    const cleanId = String(id || "").trim();
    if (!cleanId || reportedPostIds[cleanId]) continue;
    reportedPostIds[cleanId] = true;
    changed = true;
    notifyPost(cleanId);
  }
  return changed;
}

export function useHomeFeedRowEngagement(item: any) {
  const postId = homeFeedScheduleEngagementId(item);
  const commentPostId = homeFeedCommentPostId(item);

  return useSyncExternalStore(
    (listener) => {
      const unsubs = [
        subscribePost(postId, listener),
        commentPostId && commentPostId !== postId
          ? subscribePost(commentPostId, listener)
          : () => {},
        subscribePost(String(item?.id || "").trim(), listener),
      ];
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
    () => ({
      ...resolveHomeFeedLikeState(item, postId),
      saved: resolveHomeFeedSavedState(item, String(item?.id || "").trim()),
      reported: resolveHomeFeedReportedState(item, String(item?.id || "").trim()),
      commentCount: resolveHomeFeedDiscussionCount(item, commentPostId),
    }),
    () => ({
      ...resolveHomeFeedLikeState(item, postId),
      saved: resolveHomeFeedSavedState(item, String(item?.id || "").trim()),
      reported: resolveHomeFeedReportedState(item, String(item?.id || "").trim()),
      commentCount: resolveHomeFeedDiscussionCount(item, commentPostId),
    })
  );
}
