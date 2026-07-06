/** End-to-end Home Feed startup latency markers — Android first-paint diagnostics. */

export type HomeFeedStartupMarker =
  | "HOME_SCREEN_FOCUS_TS"
  | "FEED_CACHE_READY_TS"
  | "FEED_API_RESPONSE_TS"
  | "FIRST_DATA_COMMIT_TS"
  | "FIRST_CARD_MOUNT_TS"
  | "FIRST_POSTER_VISIBLE_TS";

type MarkerRecord = {
  ts: number;
  extra?: Record<string, unknown>;
};

const markers = new Map<HomeFeedStartupMarker, MarkerRecord>();
let focusOriginTs: number | null = null;
let summaryLogged = false;
const firstCardMountWaiters = new Set<() => void>();
let firstCardMounted = false;

function now() {
  return Date.now();
}

export function resetHomeFeedStartupTiming() {
  markers.clear();
  focusOriginTs = null;
  summaryLogged = false;
  firstCardMounted = false;
  firstCardMountWaiters.clear();
}

export function markHomeFeedStartupTiming(
  marker: HomeFeedStartupMarker,
  extra?: Record<string, unknown>
) {
  if (markers.has(marker)) return;

  const ts = now();
  markers.set(marker, { ts, extra });

  const msSinceFocus =
    focusOriginTs != null && marker !== "HOME_SCREEN_FOCUS_TS" ? ts - focusOriginTs : null;

  console.log(marker, {
    ts,
    msSinceFocus,
    ...(extra || {}),
  });

  if (marker === "HOME_SCREEN_FOCUS_TS") {
    focusOriginTs = ts;
    return;
  }

  if (marker === "FIRST_CARD_MOUNT_TS") {
    firstCardMounted = true;
    for (const waiter of [...firstCardMountWaiters]) {
      try {
        waiter();
      } catch {}
    }
    firstCardMountWaiters.clear();
  }

  maybeLogStartupSummary(marker);
}

export function getHomeFeedStartupMarkerTs(marker: HomeFeedStartupMarker): number | null {
  return markers.get(marker)?.ts ?? null;
}

export function msSinceHomeScreenFocus(at = now()): number | null {
  if (focusOriginTs == null) return null;
  return at - focusOriginTs;
}

export function isHomeFeedFirstCardMounted() {
  return firstCardMounted;
}

/** Run after the first FeedYouTubeCard mounts (or immediately if already mounted). */
export function runAfterHomeFeedFirstCardMount(task: () => void) {
  if (firstCardMounted) {
    task();
    return;
  }
  firstCardMountWaiters.add(task);
}

function maybeLogStartupSummary(trigger: HomeFeedStartupMarker) {
  if (summaryLogged) return;
  if (trigger !== "FIRST_POSTER_VISIBLE_TS" && trigger !== "FIRST_CARD_MOUNT_TS") return;

  const focusTs = markers.get("HOME_SCREEN_FOCUS_TS")?.ts ?? focusOriginTs;
  const firstCardTs = markers.get("FIRST_CARD_MOUNT_TS")?.ts;
  const firstPosterTs = markers.get("FIRST_POSTER_VISIBLE_TS")?.ts;
  if (!focusTs || !firstCardTs) return;

  summaryLogged = true;
  const endTs = firstPosterTs ?? firstCardTs;
  console.log("KRISTO_HOME_FEED_STARTUP_LATENCY", {
    msHomeFocusToFirstCard: firstCardTs - focusTs,
    msHomeFocusToFirstPoster: firstPosterTs != null ? firstPosterTs - focusTs : null,
    msDataCommitToFirstCard:
      markers.get("FIRST_DATA_COMMIT_TS")?.ts != null
        ? firstCardTs - (markers.get("FIRST_DATA_COMMIT_TS")!.ts)
        : null,
    msCacheReadyToDataCommit:
      markers.get("FEED_CACHE_READY_TS")?.ts != null &&
      markers.get("FIRST_DATA_COMMIT_TS")?.ts != null
        ? markers.get("FIRST_DATA_COMMIT_TS")!.ts - markers.get("FEED_CACHE_READY_TS")!.ts
        : null,
    msApiResponseToDataCommit:
      markers.get("FEED_API_RESPONSE_TS")?.ts != null &&
      markers.get("FIRST_DATA_COMMIT_TS")?.ts != null
        ? markers.get("FIRST_DATA_COMMIT_TS")!.ts - markers.get("FEED_API_RESPONSE_TS")!.ts
        : null,
    totalMsHomeFocusToVisible: endTs - focusTs,
    markers: Object.fromEntries(
      [...markers.entries()].map(([name, record]) => [name, record.ts])
    ),
  });
}
