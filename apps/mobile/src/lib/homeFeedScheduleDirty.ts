import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import { getSessionSync } from "@/src/lib/kristoSession";

type HomeFeedScheduleDirtyEntry = {
  churchId: string;
  backendFeedId: string;
  markedAt: number;
};

let pending: HomeFeedScheduleDirtyEntry | null = null;
const listeners = new Set<() => void>();

function sessionUserId() {
  const session = getSessionSync() as any;
  return String(session?.userId || "").trim();
}

export function clearHomeFeedApiCache(userId?: string) {
  const uid = String(userId || sessionUserId()).trim();
  clearResponseCacheForRequest("GET", "/api/church/feed", uid);
}

/** One-shot: Home Feed should force-reload church feed after schedule create. */
export function markHomeFeedScheduleDirty(churchId: string, backendFeedId: string) {
  const cid = String(churchId || "").trim();
  const fid = String(backendFeedId || "").trim();
  if (!cid || !fid) return;

  pending = { churchId: cid, backendFeedId: fid, markedAt: Date.now() };
  clearHomeFeedApiCache();

  console.log("KRISTO_HOME_FEED_SCHEDULE_DIRTY_MARKED", {
    churchId: cid,
    backendFeedId: fid,
  });

  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function peekHomeFeedScheduleDirty(churchId?: string): HomeFeedScheduleDirtyEntry | null {
  if (!pending) return null;
  const cid = String(churchId || "").trim();
  if (cid && pending.churchId !== cid) return null;
  return pending;
}

/** Consume and clear the dirty flag for the current church (if provided). */
export function consumeHomeFeedScheduleDirty(
  churchId?: string
): { churchId: string; backendFeedId: string } | null {
  const entry = peekHomeFeedScheduleDirty(churchId);
  if (!entry) return null;
  pending = null;
  return { churchId: entry.churchId, backendFeedId: entry.backendFeedId };
}

export function subscribeHomeFeedScheduleDirty(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
