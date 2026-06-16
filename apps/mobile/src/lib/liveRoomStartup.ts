import { InteractionManager } from "react-native";
import { Camera } from "expo-camera";
import { pauseHomeFeedPosterWorkForLiveNavigation } from "@/src/lib/homeFeedPosterPrewarm";

export const LIVE_ROOM_DEFER_MS = 300;

/** Pause Home Feed heavy render/poll while Live Room is opening or active. */
export function setHomeFeedRenderPaused(paused: boolean) {
  (globalThis as any).__KRISTO_HOME_FEED_RENDER_PAUSED__ = paused;
}

export function isHomeFeedLiveNavBackgroundPaused(): boolean {
  return Boolean((globalThis as any).__KRISTO_HOME_FEED_LIVE_NAV_PAUSED__);
}

/** Pause poster generation and startup prewarm as soon as live navigation begins. */
export function pauseHomeFeedBackgroundWorkForLiveNavigation(reason = "live-ring-nav") {
  setHomeFeedRenderPaused(true);
  (globalThis as any).__KRISTO_HOME_FEED_LIVE_NAV_PAUSED__ = true;
  pauseHomeFeedPosterWorkForLiveNavigation(reason);
  console.log("KRISTO_LIVE_BACKGROUND_WORK_PAUSED", { reason });
}

/** Request camera/mic permissions as soon as Enter Live is tapped — before room mount. */
export function prewarmLiveRoomMediaPermissions(source = "enter-live") {
  void (async () => {
    try {
      const [camera, mic] = await Promise.all([
        Camera.getCameraPermissionsAsync().catch(() => null),
        Camera.getMicrophonePermissionsAsync().catch(() => null),
      ]);

      const tasks: Promise<unknown>[] = [];
      if (!camera?.granted) {
        tasks.push(Camera.requestCameraPermissionsAsync());
      }
      if (!mic?.granted) {
        tasks.push(Camera.requestMicrophonePermissionsAsync());
      }
      if (tasks.length) {
        await Promise.all(tasks);
      }

      console.log("KRISTO_LIVE_MEDIA_PERMISSIONS_PREWARM", {
        source,
        cameraGranted: camera?.granted === true,
        micGranted: mic?.granted === true,
        requested: tasks.length,
      });
    } catch (e: any) {
      console.log("KRISTO_LIVE_MEDIA_PERMISSIONS_PREWARM_ERROR", {
        source,
        message: String(e?.message || e),
      });
    }
  })();
}

/** Clear live-room render pause and global active-live flags (e.g. after schedule slots deleted). */
export function forceKristoLiveCleanup(
  reason = "unknown",
  options?: { forceReentry?: boolean }
) {
  try {
    console.log("KRISTO_FORCE_STOP_LIVE_MEDIA", {
      reason,
      forceReentry: !!options?.forceReentry,
    });

    const g = globalThis as any;
    g.__KRISTO_LIVE_ACTIVE__ = false;
    g.__KRISTO_LIVE_ACTIVE_COUNT__ = 0;
    g.__KRISTO_HOME_FEED_RENDER_PAUSED__ = false;
    g.__KRISTO_HOME_FEED_LIVE_NAV_PAUSED__ = false;

    if (options?.forceReentry) {
      g.__KRISTO_LIVEKIT_COOLDOWN_UNTIL__ = 0;
      g.__KRISTO_DISABLE_LIVEKIT__ = false;
      g.__KRISTO_LIVEKIT_ERROR_LOCK__ = false;
      g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
      console.log("KRISTO_LIVE_REENTRY_UNLOCKED", { reason });
    }
  } catch {
    // ignore cleanup errors
  }
}

/** Clear live-room render pause flags after exiting Live Room. */
export function resumeHomeFeedAfterLiveExit() {
  setHomeFeedRenderPaused(false);
  (globalThis as any).__KRISTO_HOME_FEED_LIVE_NAV_PAUSED__ = false;
  const g = globalThis as any;
  const liveCount = Number(g.__KRISTO_LIVE_ACTIVE_COUNT__ || 0);
  if (liveCount <= 0) {
    g.__KRISTO_LIVE_ACTIVE__ = false;
  }
}

export function isHomeFeedRenderPaused(): boolean {
  return Boolean(
    (globalThis as any).__KRISTO_HOME_FEED_RENDER_PAUSED__ ||
      (globalThis as any).__KRISTO_LIVE_ACTIVE__ ||
      Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) > 0
  );
}

/** Log first shell frame, then open deferred work after interactions + short delay. */
export function runAfterLiveRoomFirstPaint(
  onDeferred: () => void,
  opts?: { deferMs?: number; onShellPaint?: (sinceMountMs: number) => void }
): () => void {
  const deferMs = Number(opts?.deferMs ?? LIVE_ROOM_DEFER_MS);
  const mountAt = Date.now();
  let cancelled = false;
  let shellLogged = false;
  let interactionTask: { cancel?: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const logShell = () => {
    if (shellLogged || cancelled) return;
    shellLogged = true;
    const sinceMountMs = Date.now() - mountAt;
    opts?.onShellPaint?.(sinceMountMs);
  };

  const raf1 = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      logShell();
      if (cancelled) return;
      interactionTask = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        timer = setTimeout(() => {
          if (!cancelled) onDeferred();
        }, deferMs);
      });
    });
  });

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf1);
    interactionTask?.cancel?.();
    if (timer) clearTimeout(timer);
  };
}

export type LiveAvatarResolver = {
  resolve: (slot: any) => string;
  noteResolvedUser: (userId: string) => void;
  flushBatchLog: () => void;
  clear: () => void;
};

export function createLiveAvatarResolver(options: {
  normalizeUri: (value: unknown) => string;
  isImageUri: (value: unknown) => boolean;
  collectCandidates: (slot: any) => string[];
  getMemberAvatar: (userId: string) => string;
  getCachedAvatar: (userId: string) => string;
  getSessionAvatar: () => string;
  sessionUserId: string;
  routeClaimedUserId: string;
  routeClaimedAvatar: string;
}): LiveAvatarResolver {
  const cache = new Map<string, string>();
  const batchUsers = new Set<string>();

  function resolve(slot: any): string {
    const userId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
    const candidateKey = options
      .collectCandidates(slot)
      .slice(0, 2)
      .map((value) => String(value || "").slice(0, 48))
      .join("|");
    const cacheKey = `${userId}|${candidateKey}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey) || "";

    let uri = "";
    for (const raw of options.collectCandidates(slot)) {
      const normalized = options.normalizeUri(raw);
      if (options.isImageUri(normalized)) {
        uri = normalized;
        break;
      }
    }

    if (!uri && userId) {
      for (const raw of [
        options.getMemberAvatar(userId),
        options.getCachedAvatar(userId),
      ]) {
        const normalized = options.normalizeUri(raw);
        if (options.isImageUri(normalized)) {
          uri = normalized;
          break;
        }
      }
    }

    if (!uri && userId && userId === options.sessionUserId) {
      const sessionUri = options.normalizeUri(options.getSessionAvatar());
      if (options.isImageUri(sessionUri)) uri = sessionUri;
    }

    if (
      !uri &&
      userId &&
      userId === options.routeClaimedUserId &&
      options.routeClaimedAvatar
    ) {
      const routeUri = options.normalizeUri(options.routeClaimedAvatar);
      if (options.isImageUri(routeUri)) uri = routeUri;
    }

    cache.set(cacheKey, uri);
    if (userId) batchUsers.add(userId);
    return uri;
  }

  return {
    resolve,
    noteResolvedUser: (userId: string) => {
      const uid = String(userId || "").trim();
      if (uid) batchUsers.add(uid);
    },
    flushBatchLog: () => {
      if (!batchUsers.size) return;
      console.log("KRISTO_LIVE_AVATAR_RESOLVE_BATCH", {
        count: batchUsers.size,
        uniqueUsers: batchUsers.size,
      });
      batchUsers.clear();
    },
    clear: () => {
      cache.clear();
      batchUsers.clear();
    },
  };
}
