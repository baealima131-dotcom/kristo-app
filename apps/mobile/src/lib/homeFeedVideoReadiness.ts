type ReadyEntry = {
  postId: string;
  videoUrl: string;
  readyAt: number;
};

const readyByKey = new Map<string, ReadyEntry>();

export function homeFeedVideoCacheKey(postId: string, videoUrl: string) {
  const id = String(postId || "").trim();
  const url = String(videoUrl || "").trim();
  return `${id}::${url}`;
}

export function markHomeFeedVideoPreloadReady(postId: string, videoUrl: string) {
  const key = homeFeedVideoCacheKey(postId, videoUrl);
  if (!key || key === "::") return false;
  readyByKey.set(key, {
    postId: String(postId || "").trim(),
    videoUrl: String(videoUrl || "").trim(),
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
 * V1 perf gate: the next-video preload must not download concurrently with the
 * first active video, or it halves the bandwidth and delays the active first
 * frame. Preload rows defer loading their source until the active video has
 * shown its first frame (or this gate has already opened earlier).
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
