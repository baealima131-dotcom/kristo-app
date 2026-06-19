import { apiGet } from "@/lib/kristoApi";
import {
  isChurchMediaRouteFailure,
  mergeScheduleSubscriptionSignals,
  parseExplicitServerSubscriptionFromMediaRoute,
  readLocalScheduleEntitlementActive,
} from "@/lib/churchMediaRouteSubscription";

export const CHURCH_RESOURCE_REFRESH_MS = 75000;

type SkipReason = "inflight" | "recent" | "cache-hit";

export type ChurchMediaRefreshResult = {
  skipped: boolean;
  reason?: SkipReason;
  mediaRes: any | null;
  hostsRes: any | null;
};

export type MinistriesRefreshResult = {
  skipped: boolean;
  reason?: SkipReason;
  ministries: any[];
  liveControlStatus: string;
  membersByMinistryId: Record<string, any[]>;
};

const mediaInflight = new Map<string, Promise<ChurchMediaRefreshResult>>();
const mediaLastAt = new Map<string, number>();
const mediaLastSnapshot = new Map<string, ChurchMediaRefreshResult>();

const ministriesInflight = new Map<string, Promise<MinistriesRefreshResult>>();
const ministriesLastAt = new Map<string, number>();
const ministriesLastSnapshot = new Map<string, MinistriesRefreshResult>();

const ministryMembersInflight = new Map<string, Promise<any[]>>();
const ministryMembersLastAt = new Map<string, number>();
const ministryMembersCache = new Map<string, any[]>();
const ministriesMembersBundleLastAt = new Map<string, number>();

/** Stable throttle key — matches screenDataCache ministriesKey (uppercase churchId). */
export function ministriesScopeKey(churchId: string, userId: string) {
  return `${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

function scopeKey(churchId: string, userId: string) {
  return ministriesScopeKey(churchId, userId);
}

function ministriesListSignature(rows: any[]) {
  return rows
    .map((m) =>
      `${String(m?.id || "")}|${String(m?.name || "")}|${String(m?.status || "")}|${Boolean(m?.mediaAccess)}`
    )
    .sort()
    .join("\n");
}

export function logMinistriesRefreshCaller(extra: {
  source: string;
  churchId: string;
  userId: string;
  reason?: string;
  force?: boolean;
  cacheFresh?: boolean;
  throttleKey: string;
}) {
  console.log("KRISTO_MINISTRIES_REFRESH_CALLER", extra);
}

function reserveMinistriesInflight(key: string): {
  promise: Promise<MinistriesRefreshResult>;
  resolve: (v: MinistriesRefreshResult) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: MinistriesRefreshResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<MinistriesRefreshResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  ministriesInflight.set(key, promise);
  return { promise, resolve, reject };
}

export function logMediaRefreshSkipped(
  reason: SkipReason,
  extra?: Record<string, unknown>
) {
  if (__DEV__) {
    console.log("KRISTO_MEDIA_REFRESH_SKIPPED", { reason, ...(extra || {}) });
  }
}

export function logMinistriesRefreshSkipped(
  reason: SkipReason,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_MINISTRIES_REFRESH_SKIPPED", { reason, ...(extra || {}) });
}

/** After disk/memory ministries cache load — blocks network refresh for 75s. */
export function seedMinistriesRefreshFromCache(args: {
  churchId: string;
  userId: string;
  items: any[];
  churchLiveControlStatus?: string;
  updatedAt?: number;
  membersByMinistryId?: Record<string, any[]>;
}) {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!churchId || !userId) return;

  const key = scopeKey(churchId, userId);
  const items = Array.isArray(args.items) ? args.items : [];
  const provided = args.membersByMinistryId || {};
  const membersByMinistryId: Record<string, any[]> = {};

  for (const m of items) {
    const id = String(m?.id || "").trim();
    if (!id) continue;
    const rows = Array.isArray(provided[id]) ? provided[id] : [];
    membersByMinistryId[id] = rows;
    if (rows.length > 0) {
      const memberKey = `${churchId}:${id}`;
      ministryMembersCache.set(memberKey, rows);
      ministryMembersLastAt.set(memberKey, Date.now());
    }
  }

  const liveControlStatus = String(args.churchLiveControlStatus || "Active");
  ministriesLastSnapshot.set(key, {
    skipped: false,
    ministries: items,
    liveControlStatus,
    membersByMinistryId,
  });
  ministriesLastAt.set(key, Number(args.updatedAt || Date.now()));
}

export async function refreshChurchMediaIfNeeded(args: {
  churchId: string;
  userId: string;
  headers: Record<string, string>;
  screen?: string;
  force?: boolean;
  includeHosts?: boolean;
}): Promise<ChurchMediaRefreshResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!churchId || !userId) {
    return { skipped: true, reason: "cache-hit", mediaRes: null, hostsRes: null };
  }

  const key = scopeKey(churchId, userId);
  const inflight = mediaInflight.get(key);
  if (inflight) {
    logMediaRefreshSkipped("inflight", { churchId, userId, screen: args.screen });
    return inflight;
  }

  const cached = mediaLastSnapshot.get(key);
  const since = Date.now() - Number(mediaLastAt.get(key) || 0);
  if (!args.force && cached && since < CHURCH_RESOURCE_REFRESH_MS) {
    logMediaRefreshSkipped("recent", { churchId, userId, sinceLastMs: since, screen: args.screen });
    return { ...cached, skipped: true, reason: "recent" };
  }

  const job = (async (): Promise<ChurchMediaRefreshResult> => {
    const mediaRes = await apiGet(
      "/api/church/media",
      { headers: args.headers },
      {
        screen: args.screen || "ChurchMediaRefresh",
        throttleMs: args.force ? 0 : CHURCH_RESOURCE_REFRESH_MS,
      }
    );

    const hostsRes = args.includeHosts
      ? await apiGet(
          "/api/church/media-hosts",
          { headers: args.headers },
          {
            screen: args.screen || "ChurchMediaRefresh",
            throttleMs: args.force ? 0 : CHURCH_RESOURCE_REFRESH_MS,
          }
        )
      : null;

    const result: ChurchMediaRefreshResult = {
      skipped: false,
      mediaRes,
      hostsRes,
    };

    mediaLastAt.set(key, Date.now());
    mediaLastSnapshot.set(key, result);
    return result;
  })();

  mediaInflight.set(key, job);
  try {
    return await job;
  } finally {
    mediaInflight.delete(key);
  }
}

export async function fetchMinistryMembersIfNeeded(args: {
  churchId: string;
  ministryId: string;
  headers: Record<string, string>;
  force?: boolean;
  source?: string;
}): Promise<{ members: any[]; skipped: boolean; reason?: SkipReason }> {
  const ministryId = String(args.ministryId || "").trim();
  const churchId = String(args.churchId || "").trim();
  if (!ministryId) return { members: [], skipped: true, reason: "cache-hit" };

  const key = `${churchId}:${ministryId}`;
  const inflight = ministryMembersInflight.get(key);
  if (inflight) {
    logMinistriesRefreshSkipped("inflight", {
      churchId,
      ministryId,
      endpoint: "ministry-members",
      source: args.source,
    });
    return { members: await inflight, skipped: true, reason: "inflight" };
  }

  const cached = ministryMembersCache.get(key);
  const since = Date.now() - Number(ministryMembersLastAt.get(key) || 0);
  if (!args.force && cached && since < CHURCH_RESOURCE_REFRESH_MS) {
    logMinistriesRefreshSkipped("cache-hit", { churchId, ministryId, sinceLastMs: since });
    return { members: cached, skipped: true, reason: "cache-hit" };
  }

  const job = (async () => {
    const res = await apiGet<any>(
      `/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`,
      { headers: args.headers },
      {
        screen: "MinistriesMembers",
        throttleMs: args.force ? 0 : CHURCH_RESOURCE_REFRESH_MS,
      }
    );
    if (!res?.ok) return [] as any[];
    return (Array.isArray(res.data) ? res.data : []) as any[];
  })();

  ministryMembersInflight.set(key, job);
  try {
    const members = await job;
    ministryMembersCache.set(key, members);
    ministryMembersLastAt.set(key, Date.now());
    return { members, skipped: false };
  } finally {
    ministryMembersInflight.delete(key);
  }
}

export async function refreshMinistriesBundleIfNeeded(args: {
  churchId: string;
  userId: string;
  headers: Record<string, string>;
  isChurchAuthority: boolean;
  force?: boolean;
  cacheFresh?: boolean;
  source?: string;
  fetchLiveControlStatus?: () => Promise<string>;
}): Promise<MinistriesRefreshResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const key = scopeKey(churchId, userId);
  const source = String(args.source || "unknown").trim();

  logMinistriesRefreshCaller({
    source,
    churchId,
    userId,
    reason: args.force ? "force" : args.cacheFresh ? "cache-fresh-check" : "refresh",
    force: args.force,
    cacheFresh: args.cacheFresh,
    throttleKey: key,
  });

  if (!churchId || !userId) {
    logMinistriesRefreshSkipped("cache-hit", { churchId, userId, reason: "missing-scope" });
    return {
      skipped: true,
      reason: "cache-hit",
      ministries: [],
      liveControlStatus: "Active",
      membersByMinistryId: {},
    };
  }

  if (!args.force && args.cacheFresh) {
    const cachedEarly = ministriesLastSnapshot.get(key);
    if (cachedEarly) {
      logMinistriesRefreshSkipped("cache-hit", {
        churchId,
        userId,
        ministries: cachedEarly.ministries.length,
        source,
        reason: "cache-fresh-flag",
      });
      return { ...cachedEarly, skipped: true, reason: "cache-hit" };
    }
  }

  const inflight = ministriesInflight.get(key);
  if (inflight) {
    logMinistriesRefreshSkipped("inflight", { churchId, userId, source });
    return inflight;
  }

  const cached = ministriesLastSnapshot.get(key);
  const since = Date.now() - Number(ministriesLastAt.get(key) || 0);
  if (!args.force && cached && since < CHURCH_RESOURCE_REFRESH_MS) {
    logMinistriesRefreshSkipped("recent", { churchId, userId, sinceLastMs: since, source });
    return { ...cached, skipped: true, reason: "recent" };
  }

  if (!args.force && args.cacheFresh && cached) {
    logMinistriesRefreshSkipped("cache-hit", { churchId, userId, ministries: cached.ministries.length, source });
    return { ...cached, skipped: true, reason: "cache-hit" };
  }

  const slot = reserveMinistriesInflight(key);

  (async () => {
    try {
      const ministriesRes = await apiGet<any>(
        "/api/church/ministries",
        { headers: args.headers },
        {
          screen: "MinistriesRefresh",
          throttleMs: args.force ? 0 : CHURCH_RESOURCE_REFRESH_MS,
        }
      );

      if (!ministriesRes?.ok) {
        throw new Error(String(ministriesRes?.error || "Fetch failed"));
      }

      const rawList = (Array.isArray(ministriesRes.data) ? ministriesRes.data : []) as any[];
      const prevSig = cached ? ministriesListSignature(cached.ministries) : "";
      const nextSig = ministriesListSignature(rawList);
      const ministriesUnchanged = Boolean(cached) && prevSig === nextSig && !args.force;

      const liveControlStatus = args.fetchLiveControlStatus
        ? await args.fetchLiveControlStatus()
        : cached?.liveControlStatus || "Active";

      const membersByMinistryId: Record<string, any[]> = ministriesUnchanged
        ? { ...(cached?.membersByMinistryId || {}) }
        : {};

      const membersBundleSince =
        Date.now() - Number(ministriesMembersBundleLastAt.get(key) || 0);
      const membersBundleRecent =
        !args.force && membersBundleSince < CHURCH_RESOURCE_REFRESH_MS;

      if (!ministriesUnchanged) {
        if (args.isChurchAuthority) {
          for (const m of rawList) {
            const id = String(m?.id || "").trim();
            if (id) membersByMinistryId[id] = [];
          }
        } else if (membersBundleRecent && cached?.membersByMinistryId) {
          logMinistriesRefreshSkipped("recent", {
            churchId,
            userId,
            source,
            endpoint: "ministry-members-bundle",
            sinceLastMs: membersBundleSince,
          });
          for (const m of rawList) {
            const id = String(m?.id || "").trim();
            if (!id) continue;
            membersByMinistryId[id] = cached.membersByMinistryId[id] || [];
          }
        } else {
          await Promise.all(
            rawList.map(async (m) => {
              const id = String(m?.id || "").trim();
              if (!id) return;
              const { members } = await fetchMinistryMembersIfNeeded({
                churchId,
                ministryId: id,
                headers: args.headers,
                force: args.force,
                source,
              });
              membersByMinistryId[id] = members;
            })
          );
          ministriesMembersBundleLastAt.set(key, Date.now());
        }
      } else {
        logMinistriesRefreshSkipped("cache-hit", { churchId, userId, ministries: rawList.length, source });
      }

      const result: MinistriesRefreshResult = {
        skipped: false,
        ministries: rawList,
        liveControlStatus,
        membersByMinistryId,
      };

      ministriesLastAt.set(key, Date.now());
      ministriesLastSnapshot.set(key, result);
      slot.resolve(result);
    } catch (error) {
      slot.reject(error);
    } finally {
      ministriesInflight.delete(key);
    }
  })();

  return slot.promise;
}

/** Subscription flag from media endpoint — shares media refresh throttle/cache. */
export async function fetchChurchSubscriptionActiveThrottled(
  churchId: string,
  headers?: Record<string, string>,
  opts?: { userId?: string; force?: boolean }
): Promise<boolean | null> {
  const cid = String(churchId || "").trim();
  const uid = String(opts?.userId || headers?.["x-kristo-user-id"] || "").trim();
  if (!cid || !uid) return null;

  const result = await refreshChurchMediaIfNeeded({
    churchId: cid,
    userId: uid,
    headers: headers || {},
    screen: "ChurchSubscription",
    force: opts?.force,
    includeHosts: false,
  });

  if (result.skipped && result.mediaRes) {
    logMediaRefreshSkipped(result.reason || "cache-hit", { churchId: cid, source: "subscription" });
  }

  const res = result.mediaRes;
  if (!res) return null;

  const explicitServerActive = parseExplicitServerSubscriptionFromMediaRoute(res);
  const merged = mergeScheduleSubscriptionSignals({
    explicitServerActive,
    routeFailed: isChurchMediaRouteFailure(res),
    entitlementActive: readLocalScheduleEntitlementActive(),
  });
  return merged.hasSubscription;
}
