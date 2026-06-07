import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { clearHomeFeedApiCache } from "@/src/lib/homeFeedScheduleDirty";
import { feedRemoveWhere } from "@/src/lib/homeFeedStore";
import {
  fetchHomeFeedFromApi,
  purgeHomeFeedPostFromBackendCache,
} from "@/src/components/homeFeed/homeFeedApi";

const listeners = new Set<(postId: string) => void>();

function normalizePostId(postId: unknown) {
  return String(postId || "").trim();
}

function homeFeedRowMatchesPostId(row: any, postId: string) {
  const target = normalizePostId(postId);
  const rowId = normalizePostId(row?.id);
  if (!target || !rowId) return false;
  if (rowId === target) return true;
  return baseFeedId(rowId) === baseFeedId(target);
}

export function subscribeHomeFeedPostDelete(fn: (postId: string) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyHomeFeedPostDelete(postId: string) {
  listeners.forEach((fn) => {
    try {
      fn(postId);
    } catch {}
  });

  const reload = (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__;
  if (typeof reload === "function") {
    try {
      reload("post-delete-sync");
    } catch {}
  }
}

export async function syncHomeFeedPostDelete(args: {
  postId: string;
  storageDeleted: boolean;
  feedDeleted: boolean;
}) {
  const postId = normalizePostId(args.postId);
  if (!postId) return;

  feedRemoveWhere((row) => homeFeedRowMatchesPostId(row, postId));
  clearHomeFeedApiCache();

  const cachePurged = await purgeHomeFeedPostFromBackendCache(postId);
  notifyHomeFeedPostDelete(postId);

  console.log("KRISTO_FEED_POST_DELETE_SYNC", {
    postId,
    storageDeleted: args.storageDeleted === true,
    feedDeleted: args.feedDeleted === true,
    cachePurged,
  });

  void fetchHomeFeedFromApi("post-delete-sync", { force: true, reconcile: true }).catch(() => {});
}
