type ProgressEntry = {
  seconds: number;
  savedAt: number;
};

const MAX_ENTRIES = 20;
const TTL_MS = 10 * 60 * 1000;

const progressByPostId = new Map<string, ProgressEntry>();
const lruOrder: string[] = [];

function touchLru(postId: string) {
  const idx = lruOrder.indexOf(postId);
  if (idx >= 0) lruOrder.splice(idx, 1);
  lruOrder.push(postId);
  while (lruOrder.length > MAX_ENTRIES) {
    const evictId = lruOrder.shift();
    if (evictId) progressByPostId.delete(evictId);
  }
}

function pruneExpired() {
  const now = Date.now();
  for (const [postId, entry] of progressByPostId) {
    if (now - entry.savedAt > TTL_MS) {
      progressByPostId.delete(postId);
      const idx = lruOrder.indexOf(postId);
      if (idx >= 0) lruOrder.splice(idx, 1);
    }
  }
}

export function saveHomeFeedVideoProgress(postId: string, seconds: number): void {
  const id = String(postId || "").trim();
  if (!id || !Number.isFinite(seconds) || seconds < 0) return;

  pruneExpired();
  const rounded = Math.round(seconds * 100) / 100;
  progressByPostId.set(id, { seconds: rounded, savedAt: Date.now() });
  touchLru(id);
  console.log("KRISTO_VIDEO_PROGRESS_SAVE", { id, seconds: rounded });
}

export function getHomeFeedVideoProgress(postId: string): number | null {
  const id = String(postId || "").trim();
  if (!id) return null;

  const entry = progressByPostId.get(id);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TTL_MS) {
    progressByPostId.delete(id);
    const idx = lruOrder.indexOf(id);
    if (idx >= 0) lruOrder.splice(idx, 1);
    return null;
  }
  return entry.seconds;
}

export function peekHomeFeedVideoRestoreSeek(postId: string): number | null {
  const saved = getHomeFeedVideoProgress(postId);
  if (saved === null || saved <= 0.1) return null;
  return Math.max(0, saved - 0.35);
}
