type ReadyEntry = {
  postId: string;
  videoUrl: string;
  readyAt: number;
};

const readyByKey = new Map<string, ReadyEntry>();

function normalizeReadinessUrl(videoUrl: string) {
  return String(videoUrl || "").trim().split("?")[0];
}

export function homeFeedVideoCacheKey(postId: string, videoUrl: string) {
  const id = String(postId || "").trim();
  const url = normalizeReadinessUrl(videoUrl);
  return `${id}::${url}`;
}

export function markHomeFeedVideoPreloadReady(postId: string, videoUrl: string) {
  const key = homeFeedVideoCacheKey(postId, videoUrl);
  if (!key || key === "::") return false;
  readyByKey.set(key, {
    postId: String(postId || "").trim(),
    videoUrl: normalizeReadinessUrl(videoUrl),
    readyAt: Date.now(),
  });
  return true;
}

export function isHomeFeedVideoPreloadReady(postId: string, videoUrl: string) {
  const key = homeFeedVideoCacheKey(postId, videoUrl);
  return readyByKey.has(key);
}

export function touchHomeFeedVideoReadiness(postId: string, videoUrl: string) {
  const key = homeFeedVideoCacheKey(postId, videoUrl);
  const existing = readyByKey.get(key);
  if (!existing) return null;
  const next = { ...existing, readyAt: Date.now() };
  readyByKey.set(key, next);
  return next;
}

export function clearHomeFeedVideoReadiness(postId: string, videoUrl: string) {
  readyByKey.delete(homeFeedVideoCacheKey(postId, videoUrl));
}

/**
 * Tracks when the active feed video has rendered its first frame. Preload rows
 * mount muted players immediately for progressive buffering; this flag is used
 * for diagnostics and optional coordination elsewhere in the feed.
 */
let activeFirstFrameSeen = false;
const activeFirstFrameListeners = new Set<() => void>();

export function isHomeFeedActiveFirstFrameReady() {
  return activeFirstFrameSeen;
}

export function markHomeFeedActiveFirstFrame() {
  if (activeFirstFrameSeen) return;
  activeFirstFrameSeen = true;
  activeFirstFrameListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

export function subscribeHomeFeedActiveFirstFrame(listener: () => void) {
  activeFirstFrameListeners.add(listener);
  return () => {
    activeFirstFrameListeners.delete(listener);
  };
}
