import type { KristoSession } from "@/src/lib/kristoSession";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  getChurchOverviewCache,
  getMinistriesCache,
  isScreenCacheFresh,
  peekChurchOverviewCache,
  peekMinistriesCache,
  silentRefreshChurchOverview,
} from "@/src/lib/screenDataCache";
import {
  refreshMinistriesBundleIfNeeded,
  seedMinistriesRefreshFromCache,
} from "@/src/lib/churchResourceRefresh";
import {
  refreshChurchMediaAccess,
  seedChurchMediaAccessFromSession,
} from "@/src/lib/refreshCoordinator";
import { fetchChurchMembers, fetchJoinRequests } from "@/src/lib/churchMembersApi";
import {
  CHURCH_TAB_REFRESH_MS,
  getChurchMembersCache,
  isChurchMembersCacheFresh,
  peekChurchMembersCache,
  saveChurchMembersCache,
} from "@/src/lib/churchTabCache";
import { preloadChurchMediaRoom } from "@/src/lib/churchMediaRoomRefresh";

export { CHURCH_TAB_REFRESH_MS };

export type ChurchFeatureScreen =
  | "ChurchOverview"
  | "ChurchMembers"
  | "ChurchMinistries"
  | "ChurchBroadcast";

const featureInflight = new Map<string, Promise<void>>();
const featureLastAt = new Map<string, number>();

function featureKey(screen: ChurchFeatureScreen, churchId: string, userId: string) {
  return `${screen}:${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

export function logChurchFeaturePreloadSkipped(
  screen: ChurchFeatureScreen,
  reason: "cache-hit" | "recent" | "inflight"
) {
  console.log("KRISTO_CHURCH_FEATURE_PRELOAD_SKIPPED", { screen, reason });
}

export function logChurchFeatureBackgroundRefresh(screen: ChurchFeatureScreen, reason: string) {
  console.log("KRISTO_CHURCH_FEATURE_BACKGROUND_REFRESH", { screen, reason });
}

export function logChurchFeatureFirstPaint(
  screen: ChurchFeatureScreen,
  cacheHit: boolean,
  itemCount: number
) {
  console.log("KRISTO_CHURCH_FEATURE_FIRST_PAINT", { screen, cacheHit, itemCount });
}

export function markChurchFeatureRefreshDone(
  screen: ChurchFeatureScreen,
  churchId: string,
  userId: string
) {
  featureLastAt.set(featureKey(screen, churchId, userId), Date.now());
}

export function shouldSkipChurchFeatureRefresh(
  screen: ChurchFeatureScreen,
  churchId: string,
  userId: string,
  opts?: { force?: boolean }
) {
  if (opts?.force) return false;
  const key = featureKey(screen, churchId, userId);
  if (featureInflight.has(key)) return true;
  const since = Date.now() - Number(featureLastAt.get(key) || 0);
  return since > 0 && since < CHURCH_TAB_REFRESH_MS;
}

async function runFeaturePreload(
  screen: ChurchFeatureScreen,
  churchId: string,
  userId: string,
  job: () => Promise<void>
) {
  const key = featureKey(screen, churchId, userId);
  if (featureInflight.has(key)) {
    logChurchFeaturePreloadSkipped(screen, "inflight");
    return featureInflight.get(key)!;
  }
  if (shouldSkipChurchFeatureRefresh(screen, churchId, userId)) {
    logChurchFeaturePreloadSkipped(screen, "recent");
    return;
  }

  const inflight = (async () => {
    try {
      await job();
      markChurchFeatureRefreshDone(screen, churchId, userId);
    } finally {
      featureInflight.delete(key);
    }
  })();

  featureInflight.set(key, inflight);
  return inflight;
}

async function preloadOverview(churchId: string, userId: string, session: KristoSession) {
  const peek = peekChurchOverviewCache(churchId, userId);
  if (peek && isScreenCacheFresh(peek.updatedAt, CHURCH_TAB_REFRESH_MS)) {
    logChurchFeaturePreloadSkipped("ChurchOverview", "cache-hit");
    return;
  }

  await runFeaturePreload("ChurchOverview", churchId, userId, async () => {
    logChurchFeatureBackgroundRefresh("ChurchOverview", "tab-preload");
    const headers = getKristoHeaders({
      userId,
      churchId,
      role: (session?.role || "Member") as any,
    }) as Record<string, string>;
    await silentRefreshChurchOverview(churchId, userId, headers);
  });
}

async function preloadMembers(churchId: string, userId: string) {
  const peek = peekChurchMembersCache(churchId, userId);
  if (peek && isChurchMembersCacheFresh(peek.updatedAt)) {
    logChurchFeaturePreloadSkipped("ChurchMembers", "cache-hit");
    return;
  }

  await runFeaturePreload("ChurchMembers", churchId, userId, async () => {
    logChurchFeatureBackgroundRefresh("ChurchMembers", "tab-preload");
    const cached = await getChurchMembersCache(churchId, userId);
    if (cached && isChurchMembersCacheFresh(cached.updatedAt)) {
      logChurchFeaturePreloadSkipped("ChurchMembers", "cache-hit");
      return;
    }

    const [members, requests] = await Promise.all([
      fetchChurchMembers().catch(() => []),
      fetchJoinRequests().catch(() => []),
    ]);

    await saveChurchMembersCache({
      churchId,
      userId,
      members: Array.isArray(members) ? members : [],
      requests: Array.isArray(requests) ? requests : [],
      updatedAt: Date.now(),
    });
  });
}

async function preloadMinistries(churchId: string, userId: string, session: KristoSession) {
  const peek = peekMinistriesCache(churchId, userId);
  const cacheFresh = Boolean(peek && isScreenCacheFresh(peek.updatedAt, CHURCH_TAB_REFRESH_MS));

  if (peek?.items?.length) {
    seedMinistriesRefreshFromCache({
      churchId: peek.churchId,
      userId: peek.userId,
      items: peek.items,
      churchLiveControlStatus: peek.churchLiveControlStatus,
      updatedAt: peek.updatedAt,
    });
  }

  if (cacheFresh) {
    logChurchFeaturePreloadSkipped("ChurchMinistries", "cache-hit");
    return;
  }

  const role = String(session?.role || session?.churchRole || "").toLowerCase();
  const isChurchAuthority =
    role.includes("pastor") || role.includes("church_admin") || role.includes("admin");

  await runFeaturePreload("ChurchMinistries", churchId, userId, async () => {
    logChurchFeatureBackgroundRefresh("ChurchMinistries", "tab-preload");
    const headers = getKristoHeaders({
      userId,
      churchId,
      role: (session?.role || "Member") as any,
    }) as Record<string, string>;

    await refreshMinistriesBundleIfNeeded({
      churchId,
      userId,
      headers,
      isChurchAuthority,
      cacheFresh,
      source: "church-tab-preload",
    });
  });
}

async function preloadMedia(churchId: string, userId: string, session: KristoSession) {
  seedChurchMediaAccessFromSession(
    {
      userId,
      role: session?.role,
      churchRole: session?.churchRole,
    },
    churchId
  );

  if (shouldSkipChurchFeatureRefresh("ChurchBroadcast", churchId, userId)) {
    logChurchFeaturePreloadSkipped("ChurchBroadcast", "recent");
    return;
  }

  await runFeaturePreload("ChurchBroadcast", churchId, userId, async () => {
    logChurchFeatureBackgroundRefresh("ChurchBroadcast", "tab-preload");
    const headers = getKristoHeaders({
      userId,
      churchId,
      role: (session?.role || "Member") as any,
    }) as Record<string, string>;

    await refreshChurchMediaAccess({
      userId,
      churchId,
      role: session?.role,
      churchRole: session?.churchRole,
      headers,
    });
  });
}

/** Staggered, non-blocking Church tab warm-up. Returns cleanup. */
export function runChurchTabPreload(session: KristoSession | null) {
  const churchId = String(session?.churchId || "").trim();
  const userId = String(session?.userId || "").trim();
  if (!churchId || !userId) {
    return () => {};
  }

  console.log("KRISTO_CHURCH_PRELOAD_START", { churchId, userId });

  const timers: ReturnType<typeof setTimeout>[] = [];
  let done = 0;
  const total = 5;

  const finish = (label: string) => {
    done += 1;
    if (done >= total) {
      console.log("KRISTO_CHURCH_PRELOAD_DONE", { churchId, userId, finished: done, label });
    }
  };

  const schedule = (ms: number, fn: () => void | Promise<void>) => {
    timers.push(
      setTimeout(() => {
        void Promise.resolve(fn()).finally(() => finish(`${ms}ms`));
      }, ms)
    );
  };

  schedule(0, () => preloadOverview(churchId, userId, session as KristoSession));
  schedule(500, () => preloadMembers(churchId, userId));
  schedule(1000, () => preloadMinistries(churchId, userId, session as KristoSession));
  schedule(1500, () => preloadMedia(churchId, userId, session as KristoSession));
  schedule(2000, () =>
    preloadChurchMediaRoom({
      churchId,
      userId,
      headers: getKristoHeaders({
        userId,
        churchId,
        role: (session?.role || "Member") as any,
      }) as Record<string, string>,
    })
  );

  return () => {
    for (const t of timers) clearTimeout(t);
  };
}
