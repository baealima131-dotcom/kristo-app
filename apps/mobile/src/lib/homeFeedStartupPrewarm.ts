import { HOME_FEED_INITIAL_LIMIT } from "@/src/components/homeFeed/homeFeedPagination";
import {
  fetchHomeFeedFromApi,
  getCachedHomeFeedBackendRows,
  persistHomeFeedBackendRowsSnapshot,
} from "@/src/components/homeFeed/homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "@/src/components/homeFeed/homeFeedRowsCache";
import { warmHomeFeedStartupMedia } from "@/src/lib/homeFeedVideoBufferAhead";
import type { KristoSession } from "@/src/lib/kristoSession";
import { isLoggedOutFlagSet, setSessionSync } from "@/src/lib/kristoSession";
import { isSessionExitInProgress } from "@/src/lib/kristoSessionExit";

const COOLDOWN_MS = 60_000;
const STARTUP_POSTER_MAX = 5;
const STARTUP_VIDEO_MAX = 3;
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
    logSkip("inflight");
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
  });

  inflight = (async () => {
    try {
      setSessionSync(session);
      await hydrateHomeFeedRowsCacheFromStorage(session.userId);

      const rows = await fetchHomeFeedFromApi("startup-prewarm", { force: true });
      const merged = getCachedHomeFeedBackendRows();
      const rowCount = merged.length || rows.length;

      console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_ROWS", {
        count: Math.min(rowCount, HOME_FEED_INITIAL_LIMIT),
      });

      const snapshotCount = await persistHomeFeedBackendRowsSnapshot(
        HOME_FEED_INITIAL_LIMIT,
        session.userId
      );

      const warmRows = getCachedHomeFeedBackendRows().slice(0, HOME_FEED_INITIAL_LIMIT);
      const media = await warmHomeFeedStartupMedia(warmRows, {
        maxPosters: STARTUP_POSTER_MAX,
        maxVideos: STARTUP_VIDEO_MAX,
        concurrency: STARTUP_CONCURRENCY,
      });

      console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_MEDIA", {
        posterCount: media.posterCount,
        videoCount: media.videoCount,
      });

      completedIdentityKey = key;
      console.log("KRISTO_HOME_FEED_STARTUP_PREWARM_DONE", {
        ms: Date.now() - startedAt,
        rows: snapshotCount || warmRows.length,
      });
    } catch {
      logSkip("failed");
    } finally {
      inflight = null;
    }
  })();

  await inflight;
}

/** Fire-and-forget Home Feed startup prewarm (rows + posters + video byte warm). */
export function startHomeFeedStartupPrewarm(session: KristoSession | null | undefined) {
  if (!isSessionReadyForPrewarm(session)) {
    logSkip("missing-session");
    return;
  }
  void runHomeFeedStartupPrewarm(session);
}
