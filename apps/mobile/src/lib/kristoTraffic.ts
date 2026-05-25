export type TrafficOptions = {
  screen?: string;
  /** Dedupe concurrent identical GETs (default true). */
  dedupe?: boolean;
  /** Skip network if same key fetched within this window; returns cached body. */
  throttleMs?: number;
};

type CacheEntry = { at: number; data: unknown };

const inflight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, CacheEntry>();
const lastFetchAt = new Map<string, number>();
const saveCooldownUntil = new Map<string, number>();
const endpointCounts = new Map<string, number>();
const screenCounts = new Map<string, number>();
const screenForceKeys = new Map<string, string>();

export function normalizeEndpoint(path: string) {
  return String(path || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

export function requestKey(method: string, path: string, userId?: string) {
  return `${String(method || "GET").toUpperCase()}:${normalizeEndpoint(path)}:${String(userId || "").trim()}`;
}

export function headerUserId(headers?: HeadersInit): string {
  if (!headers || typeof headers !== "object") return "";
  const h = headers as Record<string, string>;
  return String(h["x-kristo-user-id"] || h["X-Kristo-User-Id"] || "").trim();
}

export function logTrafficRequest(screen: string, endpoint: string) {
  const ep = normalizeEndpoint(endpoint);
  const nextEp = (endpointCounts.get(ep) || 0) + 1;
  endpointCounts.set(ep, nextEp);
  const sk = screen || "unknown";
  const nextScreen = (screenCounts.get(sk) || 0) + 1;
  screenCounts.set(sk, nextScreen);
  console.log("[Traffic] endpoint request count", {
    endpoint: ep,
    count: nextEp,
    screen: sk,
    screenCount: nextScreen,
  });
}

export function logTrafficDuplicate(endpoint: string, screen?: string) {
  console.log("[Traffic] duplicate request prevented", {
    endpoint: normalizeEndpoint(endpoint),
    screen: screen || "unknown",
  });
}

export function logTrafficPollingPaused(screen: string, reason: string) {
  console.log("[Traffic] polling paused", { screen, reason });
}

export function logTrafficCache(screen: string, key: string, hit: boolean) {
  console.log("[Traffic] cache hit/miss", { screen, key, result: hit ? "hit" : "miss" });
}

export function markSaveCooldown(scope: string, ms = 12000) {
  saveCooldownUntil.set(scope, Date.now() + ms);
}

export function isSaveCooldown(scope: string) {
  return Date.now() < Number(saveCooldownUntil.get(scope) || 0);
}

export function shouldThrottleFetch(key: string, minMs: number) {
  const last = Number(lastFetchAt.get(key) || 0);
  return last > 0 && Date.now() - last < minMs;
}

export function markFetchDone(key: string) {
  lastFetchAt.set(key, Date.now());
}

/** Allow refresh when forceKey changes (e.g. refreshAt param), else throttle by screen. */
export function shouldAllowScreenRefresh(screen: string, opts?: { forceKey?: string; minMs?: number }) {
  const minMs = opts?.minMs ?? 45000;
  const forceKey = String(opts?.forceKey || "").trim();
  if (forceKey) {
    const prev = screenForceKeys.get(screen) || "";
    if (prev !== forceKey) {
      screenForceKeys.set(screen, forceKey);
      markFetchDone(`screen:${screen}`);
      return true;
    }
  }
  const key = `screen:${screen}`;
  if (shouldThrottleFetch(key, minMs)) return false;
  markFetchDone(key);
  return true;
}

export async function dedupeInflight<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { screen?: string; endpoint?: string; throttleMs?: number }
): Promise<T> {
  const screen = opts?.screen || "unknown";
  const endpoint = opts?.endpoint || key;

  if (opts?.throttleMs && shouldThrottleFetch(key, opts.throttleMs)) {
    const cached = responseCache.get(key);
    logTrafficDuplicate(endpoint, screen);
    if (cached) return cached.data as T;
    if (inflight.has(key)) return inflight.get(key)! as Promise<T>;
    return fn();
  }

  if (inflight.has(key)) {
    logTrafficDuplicate(endpoint, screen);
    return inflight.get(key)! as Promise<T>;
  }

  logTrafficRequest(screen, endpoint);

  const promise = fn()
    .then((data) => {
      responseCache.set(key, { at: Date.now(), data });
      markFetchDone(key);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function createDebouncer(delayMs = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (fn: () => void) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delayMs);
  };
}
