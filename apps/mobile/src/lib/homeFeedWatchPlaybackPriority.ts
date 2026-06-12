type PauseListener = (paused: boolean) => void;

const BACKGROUND_JOB_NAMES = [
  "poster-prewarm",
  "poster-cache-hydrate",
  "video-disk-cache",
  "video-buffer-ahead",
  "video-thumbnail",
  "feed-polling",
] as const;

let watchScreenOpen = false;
let playbackActive = false;
let jobsPaused = false;
const pauseListeners = new Set<PauseListener>();
const resumeListeners = new Set<() => void>();

function emitPaused(paused: boolean) {
  for (const listener of pauseListeners) {
    try {
      listener(paused);
    } catch {}
  }
}

function notifyResumeListeners() {
  for (const listener of resumeListeners) {
    try {
      listener();
    } catch {}
  }
}

function pauseBackgroundMediaJobs(reason: string) {
  if (jobsPaused) return;
  jobsPaused = true;
  emitPaused(true);
  console.log("KRISTO_PLAYBACK_PRIORITY_PAUSED_JOB", {
    reason,
    jobs: BACKGROUND_JOB_NAMES,
  });
  console.log("KRISTO_BACKGROUND_MEDIA_JOBS_PAUSED_FOR_PLAYBACK", { reason });
}

function resumeBackgroundMediaJobs(reason: string) {
  if (!jobsPaused) return;
  jobsPaused = false;
  emitPaused(false);
  console.log("KRISTO_PLAYBACK_PRIORITY_RESUMED_JOB", {
    reason,
    jobs: BACKGROUND_JOB_NAMES,
  });
  console.log("KRISTO_BACKGROUND_MEDIA_JOBS_RESUMED_AFTER_PLAYBACK", { reason });
  notifyResumeListeners();
}

/** True while the watch screen owns the device — poster prewarm, cache I/O, polling, etc. should defer. */
export function shouldDeferBackgroundMediaJobs(): boolean {
  return jobsPaused;
}

export function isWatchScreenOpen(): boolean {
  return watchScreenOpen;
}

export function isWatchPlaybackActive(): boolean {
  return playbackActive;
}

export function subscribeBackgroundMediaJobsPaused(listener: PauseListener): () => void {
  listener(jobsPaused);
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

export function onBackgroundMediaJobsResumed(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

export function notifyWatchScreenOpened(postId: string) {
  watchScreenOpen = true;
  pauseBackgroundMediaJobs("watch-screen-open");
  console.log("KRISTO_PLAYBACK_PRIORITY_ACTIVE", {
    postId: String(postId || "").trim() || null,
    phase: "watch-screen-open",
  });
}

export function notifyWatchScreenClosed() {
  watchScreenOpen = false;
  playbackActive = false;
  resumeBackgroundMediaJobs("watch-screen-closed");
}

export function notifyWatchPlaybackActive(postId: string) {
  const id = String(postId || "").trim();
  playbackActive = true;
  pauseBackgroundMediaJobs("playback-active");
  console.log("KRISTO_PLAYBACK_PRIORITY_ACTIVE", { postId: id || null, phase: "playback-active" });
}

export function notifyWatchPlaybackPaused(postId?: string) {
  playbackActive = false;
  // Keep background jobs paused while the watch modal stays open.
  if (watchScreenOpen) {
    pauseBackgroundMediaJobs("playback-paused-watch-open");
  }
  console.log("KRISTO_WATCH_PLAYBACK_PAUSED", {
    postId: String(postId || "").trim() || null,
    watchScreenOpen,
    jobsPaused,
  });
}
