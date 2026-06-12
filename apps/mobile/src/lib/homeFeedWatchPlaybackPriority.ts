const PLAYBACK_IDLE_RESUME_MS = 2500;

type PauseListener = (paused: boolean) => void;

let watchScreenOpen = false;
let playbackActive = false;
let jobsPaused = false;
let idleResumeTimer: ReturnType<typeof setTimeout> | null = null;
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

function clearIdleResumeTimer() {
  if (!idleResumeTimer) return;
  clearTimeout(idleResumeTimer);
  idleResumeTimer = null;
}

function pauseBackgroundMediaJobs(reason: string) {
  if (jobsPaused) return;
  jobsPaused = true;
  emitPaused(true);
  console.log("KRISTO_BACKGROUND_MEDIA_JOBS_PAUSED_FOR_PLAYBACK", { reason });
}

function resumeBackgroundMediaJobs(reason: string) {
  if (!jobsPaused) return;
  jobsPaused = false;
  emitPaused(false);
  console.log("KRISTO_BACKGROUND_MEDIA_JOBS_RESUMED_AFTER_PLAYBACK", { reason });
  notifyResumeListeners();
}

function scheduleIdleResume() {
  clearIdleResumeTimer();
  if (!watchScreenOpen) {
    resumeBackgroundMediaJobs("watch-screen-closed");
    return;
  }
  idleResumeTimer = setTimeout(() => {
    idleResumeTimer = null;
    if (playbackActive) return;
    resumeBackgroundMediaJobs("playback-idle");
  }, PLAYBACK_IDLE_RESUME_MS);
}

/** True while watch playback owns the device — poster prewarm, cache I/O, polling, etc. should defer. */
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
  clearIdleResumeTimer();
  if (playbackActive) {
    pauseBackgroundMediaJobs("watch-screen-open-playing");
  }
  console.log("KRISTO_WATCH_PLAYBACK_ACTIVE", {
    postId: String(postId || "").trim() || null,
    phase: "watch-screen-open",
  });
}

export function notifyWatchScreenClosed() {
  watchScreenOpen = false;
  playbackActive = false;
  clearIdleResumeTimer();
  resumeBackgroundMediaJobs("watch-screen-closed");
}

export function notifyWatchPlaybackActive(postId: string) {
  const id = String(postId || "").trim();
  playbackActive = true;
  clearIdleResumeTimer();
  pauseBackgroundMediaJobs("playback-active");
  console.log("KRISTO_WATCH_PLAYBACK_ACTIVE", { postId: id || null });
}

export function notifyWatchPlaybackPaused(postId?: string) {
  playbackActive = false;
  scheduleIdleResume();
  console.log("KRISTO_WATCH_PLAYBACK_PAUSED", {
    postId: String(postId || "").trim() || null,
    resumeAfterMs: PLAYBACK_IDLE_RESUME_MS,
  });
}
