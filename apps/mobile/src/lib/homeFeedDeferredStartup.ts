import {
  getHomeFeedFirstPaintReadyAt,
  isHomeTabFocused,
  subscribeHomeFeedFirstPaintReady,
} from "./homeStartupGate";

/** Delay non-Home startup work until Home first paint + idle window (or user leaves Home). */
export const HOME_DEFERRED_STARTUP_MS = 7000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const queueList: Array<{ fn: () => void; reason: string }> = [];

function firstPaintReadyAt() {
  return getHomeFeedFirstPaintReadyAt();
}

export function notifyUserLeftHomeTab() {
  flushDeferredStartupWork("left-home-tab");
}

export function canRunHomeDeferredStartupWork(now = Date.now()): boolean {
  const readyAt = firstPaintReadyAt();
  if (!readyAt) return false;
  if (now - readyAt >= HOME_DEFERRED_STARTUP_MS) return true;
  return !isHomeTabFocused();
}

export function runAfterHomeDeferredStartup(
  fn: () => void | Promise<void>,
  opts?: { reason?: string; minDelayMs?: number }
) {
  const reason = String(opts?.reason || "deferred-startup").trim() || "deferred-startup";
  const minDelayMs = Math.max(0, Number(opts?.minDelayMs ?? HOME_DEFERRED_STARTUP_MS));

  const run = () => {
    void fn();
  };

  const readyAt = firstPaintReadyAt();
  if (readyAt != null) {
    const elapsed = Date.now() - readyAt;
    const remaining = Math.max(0, minDelayMs - elapsed);
    if (canRunHomeDeferredStartupWork() && remaining <= 0) {
      run();
      return;
    }
    if (canRunHomeDeferredStartupWork() && remaining > 0) {
      setTimeout(run, remaining);
      return;
    }
  }

  queueList.push({ fn: run, reason });
  scheduleDeferredStartupFlush(minDelayMs);
}

function scheduleDeferredStartupFlush(minDelayMs = HOME_DEFERRED_STARTUP_MS) {
  if (!firstPaintReadyAt()) return;
  if (flushTimer) return;

  const readyAt = firstPaintReadyAt() as number;
  const elapsed = Date.now() - readyAt;
  const waitMs = Math.max(0, minDelayMs - elapsed);

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushDeferredStartupWork("timer");
  }, waitMs);
}

function flushDeferredStartupWork(trigger: string) {
  if (!canRunHomeDeferredStartupWork()) {
    scheduleDeferredStartupFlush();
    return;
  }

  if (__DEV__ && queueList.length) {
    console.log("KRISTO_DEFERRED_STARTUP_FLUSH", {
      trigger,
      queued: queueList.map((item) => item.reason),
      msSinceFirstPaint: firstPaintReadyAt() ? Date.now() - (firstPaintReadyAt() as number) : null,
    });
  }

  const pending = queueList.splice(0, queueList.length);
  for (const item of pending) {
    try {
      item.fn();
    } catch {}
  }
}

subscribeHomeFeedFirstPaintReady(() => {
  scheduleDeferredStartupFlush();
});
