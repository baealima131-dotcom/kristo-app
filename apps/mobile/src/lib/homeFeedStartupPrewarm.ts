import { HOME_FEED_INITIAL_LIMIT } from "@/src/components/homeFeed/homeFeedPagination";
import {
  fetchHomeFeedFromApi,
  getCachedHomeFeedBackendRows,
  persistHomeFeedBackendRowsSnapshot,
} from "@/src/components/homeFeed/homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "@/src/components/homeFeed/homeFeedRowsCache";
import { hydrateHomeFeedPage0FromStorage } from "@/src/components/homeFeed/homeFeedPageCache";
import { isHomeFeedYouTubeStyleVideo } from "@/src/lib/homeFeedVideoMode";
import { prepareFirstHomeFeedVideo } from "@/src/lib/homeFeedVideoStartup";
import { deferStartupWorkAfterHomeFirstFrame } from "./firstPaint";
import {
  buildHomeFeedDisplayRows,
  mergeCachedHomeFeedDisplayOrder,
} from "@/src/components/homeFeed/homeFeedUtils";
import { peekHomeFeedDisplayOrderSync } from "@/src/components/homeFeed/homeFeedDisplayOrderCache";
import { feedList } from "@/src/lib/homeFeedStore";
import type { KristoSession } from "@/src/lib/kristoSession";
import { isLoggedOutFlagSet, setSessionSync } from "@/src/lib/kristoSession";
import { isSessionExitInProgress } from "@/src/lib/kristoSessionExit";
import {
  warmHomeFeedStartupMedia,
} from "@/src/lib/homeFeedVideoBufferAhead";
import { isHomeFeedInlineVideoAutoplayEnabled } from "@/src/lib/homeFeedVideoMode";
import { startInitialHomeFeedPosterPrewarm, startYoutubeHomeFeedVisiblePosterPrewarm } from "@/src/lib/homeFeedPosterPrewarm";
import { hydrateMediaPosterCache } from "@/src/lib/mediaPosterCache";
import { isHomeFeedLiveNavBackgroundPaused } from "@/src/lib/liveRoomStartup";

const COOLDOWN_MS = 60_000;
const STARTUP_POSTER_MAX = 4;
const STARTUP_VIDEO_MAX = 1;
const STARTUP_CONCURRENCY = 2;

let inflight: Promise<void> | null = null;
let lastIdentityKey = "";
let lastStartedAt = 0;
let completedIdentityKey = "";

function identityKey(session: KristoSession) {
  const userId = String(session.userId || "").trim();
  const churchId = String(session.churchId || "").trim();
  return `${userId}:${churchId}`;
}

function logSkip(reason: string) {
  console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_SKIP", { reason });
}

function isSessionReadyForPrewarm(session: KristoSession | null): session is KristoSession {
  if (!session) return false;
  const userId = String(session.userId || "").trim();
  const sessionToken = String(session.sessionToken || "").trim();
  const churchId = String(session.churchId || "").trim();
  return Boolean(userId && sessionToken && churchId);
}

async function runHomeFeedStartupPrewarm(session: KristoSession) {
  if (isHomeFeedLiveNavBackgroundPaused()) {
    logSkip("live-navigation");
    return;
  }
  if (await isLoggedOutFlagSet()) {
    logSkip("logged-out");
    return;
  }
  if (isSessionExitInProgress()) {
    logSkip("session-exit");
    return;
  }

  const key = identityKey(session);
  if (key !== lastIdentityKey) {
    if (completedIdentityKey && completedIdentityKey !== key) {
      completedIdentityKey = "";
    }
    lastIdentityKey = key;
  }

  if (completedIdentityKey === key) {
    logSkip("already-done-this-launch");
    return;
  }

  const now = Date.now();
  if (inflight) {
    await inflight;
    return;
  }
  if (lastStartedAt > 0 && now - lastStartedAt < COOLDOWN_MS && completedIdentityKey) {
    logSkip("cooldown");
    return;
  }

  lastStartedAt = now;
  const startedAt = now;

  console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_START", {
    userId: session.userId,
    churchId: session.churchId || null,
    youtubeStyle: isHomeFeedYouTubeStyleVideo(),
  });

  inflight = (async () => {
    if (isHomeFeedYouTubeStyleVideo()) {
      try {
        setSessionSync(session);
      } catch {}

      let warmRows: any[] = [];
      try {
        warmRows = (await hydrateHomeFeedPage0FromStorage(session.userId)) || [];
      } catch {}

      try {
        await hydrateMediaPosterCache();
      } catch {}

      if (warmRows.length) {
        startYoutubeHomeFeedVisiblePosterPrewarm(warmRows);
      }

      completedIdentityKey = key;
      console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_DONE", {
        userId: session.userId,
        elapsedMs: Date.now() - startedAt,
        youtubeStyle: true,
        posterBatch: warmRows.length,
      });
      return;
    }

    if (!isHomeFeedInlineVideoAutoplayEnabled()) {
      logSkip("youtube-style-feed");
      return;
    }
    const failures: string[] = [];
    let snapshotCount = 0;
    let warmRows: any[] = [];

    try {
      setSessionSync(session);
    } catch {
      failures.push("session-sync");
    }

    try {
      if (isHomeFeedYouTubeStyleVideo()) {
        await hydrateHomeFeedPage0FromStorage(session.userId);
      } else {
        await hydrateHomeFeedRowsCacheFromStorage(session.userId);
      }
    } catch {
      failures.push("hydrate-cache");
    }

    try {
      await prepareFirstHomeFeedVideo(session);
    } catch {
      failures.push("prepare-first-video-before-open");
    }

    let rowCount = 0;
    try {
      const rows = await fetchHomeFeedFromApi("startup-prewarm");
      const merged = getCachedHomeFeedBackendRows();
      rowCount = merged.length || rows.length;
    } catch {
      failures.push("fetch-feed");
      rowCount = getCachedHomeFeedBackendRows().length;
    }

    console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_ROWS", {
      count: Math.min(
        rowCount,
        isHomeFeedYouTubeStyleVideo() ? 7 : HOME_FEED_INITIAL_LIMIT
      ),
    });

    if (!isHomeFeedYouTubeStyleVideo()) {
      try {
        snapshotCount = await persistHomeFeedBackendRowsSnapshot(
          HOME_FEED_INITIAL_LIMIT,
          session.userId
        );
      } catch {
        failures.push("persist-snapshot");
      }

      const cachedDisplay = peekHomeFeedDisplayOrderSync();
      const displayRows = cachedDisplay.length
        ? mergeCachedHomeFeedDisplayOrder(
            cachedDisplay,
            getCachedHomeFeedBackendRows(),
            feedList()
          )
        : buildHomeFeedDisplayRows(getCachedHomeFeedBackendRows(), feedList(), Date.now(), {
            rebuildPersonalOrder: false,
          });
      startInitialHomeFeedPosterPrewarm(displayRows);

      warmRows = displayRows.slice(0, HOME_FEED_INITIAL_LIMIT);
    }

    // Poster/byte warm for remaining rows — only after first video frame paints.
    deferStartupWorkAfterHomeFirstFrame(
      async () => {
        if (isHomeFeedLiveNavBackgroundPaused()) return;
        try {
          const warmed = await warmHomeFeedStartupMedia(warmRows, {
            maxPosters: STARTUP_POSTER_MAX,
            maxVideos: STARTUP_VIDEO_MAX,
            concurrency: STARTUP_CONCURRENCY,
          });
          console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_MEDIA", {
            posterCount: warmed.posterCount,
            videoCount: warmed.videoCount,
            posterFailed: warmed.posterFailed,
            videoFailed: warmed.videoFailed,
          });
        } catch {
          failures.push("warm-media");
        }
      },
      { reason: "startup-prewarm-media", delayMs: 400 }
    );

    // Now that the feed exists and the first video's startup bytes are warmed,
    // publish readiness on the EXACT URL the player will mount. On cold start the
    // first prepare pass (above) ran against an empty cache and was intentionally
    // not locked, so this re-run warms the real first URL and marks the readiness
    // store — satisfying "prepared before open" + restore.
    try {
      await prepareFirstHomeFeedVideo(session);
    } catch {
      failures.push("prepare-first-video-after-fetch");
    }

    completedIdentityKey = key;
    console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_DONE", {
      ms: Date.now() - startedAt,
      rows: snapshotCount || warmRows.length,
      mediaWarm: "deferred-after-first-frame",
      failures: failures.length ? failures : undefined,
    });
  })().finally(() => {
    inflight = null;
  });

  await inflight;
}

/** Fire-and-forget Home Feed startup prewarm (rows + posters + video byte warm). */
export function startHomeFeedStartupPrewarm(session: KristoSession | null | undefined) {
  if (isHomeFeedLiveNavBackgroundPaused()) {
    logSkip("live-navigation");
    return;
  }
  if (
    !isHomeFeedInlineVideoAutoplayEnabled() &&
    !isHomeFeedYouTubeStyleVideo()
  ) {
    logSkip("youtube-style-feed");
    return;
  }
  if (!session || !isSessionReadyForPrewarm(session)) {
    logSkip("missing-session");
    return;
  }
  void runHomeFeedStartupPrewarm(session);
}
