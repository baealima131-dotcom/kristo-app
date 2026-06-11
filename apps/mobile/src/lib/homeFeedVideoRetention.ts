/** Session retention for watched Home Feed videos (first frame + playback position). */

const firstFrameShownAtByPostId = new Map<string, number>();
const watchedAtByPostId = new Map<string, number>();

export function markHomeFeedVideoFirstFrameShown(postId: string): void {
  const id = String(postId || "").trim();
  if (!id) return;
  firstFrameShownAtByPostId.set(id, Date.now());
}

export function wasHomeFeedVideoFirstFrameShown(postId: string): boolean {
  const id = String(postId || "").trim();
  if (!id) return false;
  return firstFrameShownAtByPostId.has(id);
}

/** Mark after meaningful playback so mount/disk retention can pin this row. */
export function markHomeFeedVideoWatched(postId: string): void {
  const id = String(postId || "").trim();
  if (!id) return;
  watchedAtByPostId.set(id, Date.now());
  firstFrameShownAtByPostId.set(id, firstFrameShownAtByPostId.get(id) ?? Date.now());
}

export function wasHomeFeedVideoWatched(postId: string): boolean {
  const id = String(postId || "").trim();
  if (!id) return false;
  return watchedAtByPostId.has(id) || firstFrameShownAtByPostId.has(id);
}

export function clearHomeFeedVideoRetention(postId?: string): void {
  const id = String(postId || "").trim();
  if (!id) {
    firstFrameShownAtByPostId.clear();
    watchedAtByPostId.clear();
    return;
  }
  firstFrameShownAtByPostId.delete(id);
  watchedAtByPostId.delete(id);
}

export function __resetHomeFeedVideoRetentionForTest(): void {
  firstFrameShownAtByPostId.clear();
  watchedAtByPostId.clear();
}
