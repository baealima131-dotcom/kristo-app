import type { KristoSession } from "./kristoSession";
import { apiGet } from "./kristoApi";
import { getKristoHeaders } from "./kristoHeaders";
import {
  evaluateChurchMediaAccessFromSession,
  stabilizeChurchMediaAccess,
  type ChurchMediaAccessSession,
  type ChurchMediaAccessState,
} from "./churchMediaAccess";
import { deferNonCriticalRefresh } from "./firstPaint";
import { shouldThrottleFetch } from "./kristoTraffic";

function logEndpointTiming(
  endpoint: string,
  ms: number,
  status: string,
  extra?: Record<string, unknown>
) {
  if (__DEV__) {
    console.log("KRISTO_ENDPOINT_TIMING", { endpoint, ms, status, ...(extra || {}) });
  }
}
import {
  silentRefreshChurchOverview,
  silentRefreshProfileScreen,
  SCREEN_CACHE_TTL_MS,
} from "./screenDataCache";

export type RefreshLane = "session" | "overview" | "mediaAccess" | "ministries" | "homeFeed";

const LANE_GAP_MS: Record<RefreshLane, number> = {
  session: 0,
  overview: 350,
  mediaAccess: 750,
  ministries: 1300,
  homeFeed: 1900,
};

const LANE_MIN_MS: Record<RefreshLane, number> = {
  session: 120000,
  overview: SCREEN_CACHE_TTL_MS,
  mediaAccess: 60000,
  ministries: SCREEN_CACHE_TTL_MS,
  homeFeed: SCREEN_CACHE_TTL_MS,
};

const laneInflight = new Map<string, Promise<unknown>>();
const laneLastDone = new Map<string, number>();
const screenTimers = new Map<string, ReturnType<typeof setTimeout>>();

let cachedMediaAccess: ChurchMediaAccessState | null = null;
let cachedMediaAccessKey = "";
const mediaAccessListeners = new Set<(access: ChurchMediaAccessState) => void>();

let sessionHydrationInflight: Promise<KristoSession | null> | null = null;
let lastHydratedSessionKey = "";

const COORDINATED_REFRESH_MIN_MS = 90000;
const COORDINATED_REFRESH_FORCE_MIN_MS = 30000;
let lastCoordinatedRefreshAt = 0;
let coordinatedRefreshInflight: Promise<void> | null = null;

export function getCachedChurchMediaAccess() {
  return cachedMediaAccess;
}

export function subscribeChurchMediaAccess(listener: (access: ChurchMediaAccessState) => void) {
  mediaAccessListeners.add(listener);
  if (cachedMediaAccess) listener(cachedMediaAccess);
  return () => {
    mediaAccessListeners.delete(listener);
  };
}

function publishMediaAccess(
  prev: ChurchMediaAccessState | null,
  next: ChurchMediaAccessState,
  session?: ChurchMediaAccessSession | null
) {
  const stabilized = stabilizeChurchMediaAccess(prev, next, session);
  cachedMediaAccess = stabilized;
  for (const listener of mediaAccessListeners) {
    listener(stabilized);
  }
  return stabilized;
}

function laneKey(lane: RefreshLane, scope: string) {
  return `${lane}:${scope}`;
}

function shouldRunLane(lane: RefreshLane, scope: string, force?: boolean) {
  if (force) return true;
  const key = laneKey(lane, scope);
  return !shouldThrottleFetch(key, LANE_MIN_MS[lane]);
}

function markLaneDone(lane: RefreshLane, scope: string) {
  laneLastDone.set(laneKey(lane, scope), Date.now());
}

export function seedChurchMediaAccessFromSession(session?: ChurchMediaAccessSession | null) {
  if (!session?.userId) return null;
  const key = `${String(session.userId)}:${String(session.churchRole || session.role || "")}`;
  const baseline = evaluateChurchMediaAccessFromSession(session);
  if (cachedMediaAccessKey !== key || !cachedMediaAccess) {
    cachedMediaAccessKey = key;
    return publishMediaAccess(null, baseline, session);
  }
  return publishMediaAccess(cachedMediaAccess, baseline, session);
}

export async function refreshChurchMediaAccess(args: {
  userId: string;
  churchId: string;
  role?: string;
  churchRole?: string;
  headers?: Record<string, string>;
  force?: boolean;
}): Promise<ChurchMediaAccessState> {
  const scope = `${args.churchId}:${args.userId}`;
  const inflightKey = laneKey("mediaAccess", scope);
  if (laneInflight.has(inflightKey)) {
    return laneInflight.get(inflightKey)! as Promise<ChurchMediaAccessState>;
  }
  if (!shouldRunLane("mediaAccess", scope, args.force)) {
    const session: ChurchMediaAccessSession = {
      userId: args.userId,
      role: args.role,
      churchRole: args.churchRole,
    };
    return (
      cachedMediaAccess ||
      publishMediaAccess(null, evaluateChurchMediaAccessFromSession(session), session)
    );
  }

  const session: ChurchMediaAccessSession = {
    userId: args.userId,
    role: args.role,
    churchRole: args.churchRole,
  };
  seedChurchMediaAccessFromSession(session);

  const job = (async () => {
    const headers =
      args.headers ||
      (getKristoHeaders({
        userId: args.userId,
        role: (args.role || "Member") as any,
        churchId: args.churchId,
      }) as Record<string, string>);

    const started = Date.now();
    const res: any = await apiGet(
      "/api/church/media-hosts",
      { headers },
      { screen: "RefreshCoordinator", throttleMs: args.force ? 0 : LANE_MIN_MS.mediaAccess }
    );
    logEndpointTiming(
      "/api/church/media-hosts",
      Date.now() - started,
      res?.ok === false ? "error" : "ok",
      { lane: "mediaAccess" }
    );

    const next = evaluateChurchMediaAccessFromSession(
      session,
      res?.ok === true ? res : undefined
    );
    markLaneDone("mediaAccess", scope);
    return publishMediaAccess(cachedMediaAccess, next, session);
  })();

  laneInflight.set(inflightKey, job);
  try {
    return await job;
  } finally {
    laneInflight.delete(inflightKey);
  }
}

export async function hydrateSessionOnce(
  session: KristoSession | null,
  syncFn: (session: KristoSession) => Promise<KristoSession | null | undefined>
): Promise<KristoSession | null> {
  const userId = String(session?.userId || "").trim();
  if (!userId) return null;

  const key = `${userId}:${String(session?.churchId || "")}`;
  if (sessionHydrationInflight && lastHydratedSessionKey === key) {
    return sessionHydrationInflight;
  }

  lastHydratedSessionKey = key;
  sessionHydrationInflight = (async () => {
    const started = Date.now();
    const synced = (await syncFn(session as KristoSession)) || session;
    logEndpointTiming("/api/auth/profile", Date.now() - started, "ok", { lane: "session" });
    markLaneDone("session", userId);
    return synced || null;
  })().finally(() => {
    sessionHydrationInflight = null;
  });

  return sessionHydrationInflight;
}

export async function runCoordinatedAppRefresh(
  session: KristoSession | null,
  opts?: { force?: boolean; lanes?: RefreshLane[]; deferMs?: number }
): Promise<void> {
  const userId = String(session?.userId || "").trim();
  if (!userId) return;

  const deferMs = Number(opts?.deferMs ?? 0);
  if (deferMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, deferMs));
  }

  const churchId = String(session?.churchId || "").trim();
  const scope = `${userId}:${churchId}`;
  const force = Boolean(opts?.force);

  if (coordinatedRefreshInflight) {
    await coordinatedRefreshInflight;
    const sinceAfter = Date.now() - lastCoordinatedRefreshAt;
    const minGapAfter = force ? COORDINATED_REFRESH_FORCE_MIN_MS : COORDINATED_REFRESH_MIN_MS;
    if (sinceAfter < minGapAfter) return;
  } else if (!force && Date.now() - lastCoordinatedRefreshAt < COORDINATED_REFRESH_MIN_MS) {
    if (__DEV__) {
      console.log("KRISTO_REFRESH_COORDINATOR_SKIPPED", {
        userId,
        churchId,
        reason: "throttled",
        sinceLastMs: Date.now() - lastCoordinatedRefreshAt,
        minGapMs: COORDINATED_REFRESH_MIN_MS,
      });
    }
    return;
  }

  const lanes = opts?.lanes || (["overview", "mediaAccess", "ministries"] as RefreshLane[]);
  const headers = getKristoHeaders({
    userId,
    role: (session?.role || "Member") as any,
    churchId,
  }) as Record<string, string>;

  const job = (async () => {
    console.log("KRISTO_REFRESH_COORDINATOR_START", {
      userId,
      churchId,
      lanes,
      force,
    });

    for (const lane of lanes) {
      const gap = LANE_GAP_MS[lane];
      if (gap > 0) {
        await new Promise((resolve) => setTimeout(resolve, gap));
      }

      if (lane === "overview" && churchId) {
        if (!shouldRunLane("overview", scope, force)) continue;
        await silentRefreshChurchOverview(churchId, userId, headers, { force });
        markLaneDone("overview", scope);
        continue;
      }

      if (lane === "mediaAccess" && churchId) {
        await refreshChurchMediaAccess({
          userId,
          churchId,
          role: session?.role,
          churchRole: session?.churchRole,
          headers,
          force,
        });
        continue;
      }

      if (lane === "ministries") {
        markLaneDone("ministries", scope);
        continue;
      }

      if (lane === "homeFeed") {
        markLaneDone("homeFeed", scope);
      }
    }

    if (!force) {
      await silentRefreshProfileScreen(session as KristoSession, opts);
    }

    lastCoordinatedRefreshAt = Date.now();
    console.log("KRISTO_REFRESH_COORDINATOR_DONE", { userId, churchId, lanes });
  })();

  coordinatedRefreshInflight = job;
  try {
    await job;
  } finally {
    coordinatedRefreshInflight = null;
  }
}

/** Warm caches after first paint — never blocks tab/screen opening. */
export function scheduleCoordinatedAppRefresh(
  session: KristoSession | null,
  opts?: { force?: boolean; lanes?: RefreshLane[]; delayMs?: number }
) {
  deferNonCriticalRefresh(
    () => runCoordinatedAppRefresh(session, { ...opts, deferMs: 0 }),
    opts?.delayMs ?? 2400
  );
}

export function scheduleScreenRefresh(
  screen: string,
  lane: RefreshLane,
  task: () => void | Promise<void>,
  opts?: { delayMs?: number; minMs?: number; force?: boolean }
) {
  const scope = screen;
  const timerKey = `${screen}:${lane}`;
  const existing = screenTimers.get(timerKey);
  if (existing) clearTimeout(existing);

  const minMs = opts?.minMs ?? LANE_MIN_MS[lane];
  const laneThrottleKey = laneKey(lane, scope);
  if (!opts?.force && shouldThrottleFetch(laneThrottleKey, minMs)) {
    logEndpointTiming(lane, 0, "skipped", { screen, reason: "throttled" });
    return;
  }

  const delayMs = opts?.delayMs ?? LANE_GAP_MS[lane];
  const timer = setTimeout(() => {
    screenTimers.delete(timerKey);
    if (laneInflight.has(laneThrottleKey)) return;

    const job = Promise.resolve()
      .then(() => task())
      .finally(() => {
        markLaneDone(lane, scope);
        laneInflight.delete(laneThrottleKey);
      });

    laneInflight.set(laneThrottleKey, job);
  }, delayMs);

  screenTimers.set(timerKey, timer);
}
