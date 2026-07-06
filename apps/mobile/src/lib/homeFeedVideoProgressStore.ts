type ProgressEntry = {
  seconds: number;
  savedAt: number;
};

const MAX_ENTRIES = 20;
const TTL_MS = 10 * 60 * 1000;
/** Treat saved progress within this many seconds of duration as completed. */
const END_TOLERANCE_SEC = 4;
/** Treat saved progress at or above this fraction of duration as completed. */
const END_RATIO_THRESHOLD = 0.95;
/** Only apply the absolute tail window when the clip is long enough. */
const MIN_DURATION_FOR_ABSOLUTE_TAIL_SEC = 10;

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

export function clearHomeFeedVideoProgress(postId: string): void {
  const id = String(postId || "").trim();
  if (!id) return;
  if (!progressByPostId.has(id)) return;
  progressByPostId.delete(id);
  const idx = lruOrder.indexOf(id);
  if (idx >= 0) lruOrder.splice(idx, 1);
}

export function isHomeFeedVideoProgressAtEnd(
  seconds: number,
  durationSec?: number | null
): boolean {
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (seconds >= duration * END_RATIO_THRESHOLD) return true;
  if (
    duration >= MIN_DURATION_FOR_ABSOLUTE_TAIL_SEC &&
    seconds >= duration - END_TOLERANCE_SEC
  ) {
    return true;
  }
  return false;
}

export function saveHomeFeedVideoProgress(
  postId: string,
  seconds: number,
  durationSec?: number | null
): void {
  const id = String(postId || "").trim();
  if (!id || !Number.isFinite(seconds) || seconds < 0) return;

  pruneExpired();
  const rounded = Math.round(seconds * 100) / 100;

  if (isHomeFeedVideoProgressAtEnd(rounded, durationSec)) {
    clearHomeFeedVideoProgress(id);
    return;
  }

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

export function peekHomeFeedVideoRestoreSeek(
  postId: string,
  durationSec?: number | null
): number | null {
  const saved = getHomeFeedVideoProgress(postId);
  if (saved === null || saved <= 0.1) return null;

  if (isHomeFeedVideoProgressAtEnd(saved, durationSec)) {
    clearHomeFeedVideoProgress(postId);
    console.log("KRISTO_WATCH_VIDEO_PROGRESS_RESET_AT_END", {
      postId,
      savedSeconds: saved,
      durationSec: durationSec ?? null,
    });
    return null;
  }

  return Math.max(0, saved - 0.35);
}
