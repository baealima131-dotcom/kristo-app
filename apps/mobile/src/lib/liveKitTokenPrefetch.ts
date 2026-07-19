import { apiPost, getApiBase } from "@/src/lib/kristoApi";
import { logLiveKitTokenClaims } from "@/src/lib/liveKitTokenDecode";
import { logLiveKitTokenResult, logLiveKitTokenStart } from "@/src/lib/liveKitPerf";

export type LiveKitTokenRequest = {
  roomName: string;
  identity: string;
  canPublish: boolean;
  headers: Record<string, string>;
  source?: string;
  /** Bypass in-memory cache and fetch a new JWT. */
  forceRefresh?: boolean;
};

export function invalidateLiveKitTokenCache(input: {
  roomName?: string;
  identity?: string;
}): void {
  const g = globalThis as any;
  const store = g.__KRISTO_LIVEKIT_TOKEN_CACHE__;
  if (!store || typeof store !== "object") return;
  const roomName = String(input.roomName || "").trim();
  const identity = String(input.identity || "").trim();
  if (!roomName && !identity) {
    g.__KRISTO_LIVEKIT_TOKEN_CACHE__ = {};
    return;
  }
  for (const key of Object.keys(store)) {
    const parts = String(key || "").split("|");
    const keyRoom = String(parts[0] || "");
    const keyIdentity = String(parts[1] || "");
    if (roomName && keyRoom !== roomName) continue;
    if (identity && keyIdentity !== identity) continue;
    delete store[key];
  }
}

type TokenCacheEntry = {
  url: string;
  token: string;
  fetchedAt: number;
};

function cacheKey(input: LiveKitTokenRequest) {
  const roomName = String(input.roomName || "").trim();
  const identity = String(input.identity || "").trim();
  const publish = input.canPublish ? "1" : "0";
  return `${roomName}|${identity}|${publish}`;
}

function readCache(key: string): TokenCacheEntry | null {
  const store = (globalThis as any).__KRISTO_LIVEKIT_TOKEN_CACHE__ || {};
  const entry = store[key] as TokenCacheEntry | undefined;
  if (!entry?.url || !entry?.token) return null;
  if (Date.now() - Number(entry.fetchedAt || 0) > 5 * 60_000) return null;
  return entry;
}

function writeCache(key: string, entry: TokenCacheEntry) {
  const g = globalThis as any;
  const store = g.__KRISTO_LIVEKIT_TOKEN_CACHE__ || {};
  g.__KRISTO_LIVEKIT_TOKEN_CACHE__ = store;
  store[key] = entry;
}

function readInflight(key: string): Promise<TokenCacheEntry | null> | null {
  const store = (globalThis as any).__KRISTO_LIVEKIT_TOKEN_INFLIGHT__ || {};
  return store[key] || null;
}

function writeInflight(key: string, promise: Promise<TokenCacheEntry | null> | null) {
  const g = globalThis as any;
  const store = g.__KRISTO_LIVEKIT_TOKEN_INFLIGHT__ || {};
  g.__KRISTO_LIVEKIT_TOKEN_INFLIGHT__ = store;
  if (!promise) {
    delete store[key];
    return;
  }
  store[key] = promise;
}

export function prefetchLiveKitToken(input: LiveKitTokenRequest) {
  void fetchLiveKitToken({ ...input, source: input.source || "prefetch" });
}

export async function fetchLiveKitToken(
  input: LiveKitTokenRequest
): Promise<{ url: string; token: string } | null> {
  const roomName = String(input.roomName || "").trim();
  const identity = String(input.identity || "").trim();
  if (!roomName || !identity) return null;

  const key = cacheKey(input);
  if (input.forceRefresh) {
    invalidateLiveKitTokenCache({ roomName, identity });
    writeInflight(key, null);
  } else {
    const cached = readCache(key);
    if (cached) {
      logLiveKitTokenResult({
        source: input.source || "cache",
        roomName,
        identity,
        canPublish: input.canPublish,
        ok: true,
        cacheHit: true,
      });
      return { url: cached.url, token: cached.token };
    }

    const inflight = readInflight(key);
    if (inflight) {
      const resolved = await inflight;
      return resolved ? { url: resolved.url, token: resolved.token } : null;
    }
  }

  logLiveKitTokenStart({
    source: input.source || "fetch",
    roomName,
    identity,
    canPublish: input.canPublish,
    apiBase: getApiBase(),
  });

  const wantsPublish = input.canPublish === true;
  const tokenHeaders = wantsPublish
    ? { ...(input.headers || {}), "x-kristo-role": "Host" }
    : input.headers;

  const promise = (async (): Promise<TokenCacheEntry | null> => {
    try {
      const res: any = await apiPost(
        "/api/livekit/token",
        { roomName, canPublish: wantsPublish, identity },
        { headers: tokenHeaders }
      );

      const ok = !!(res?.ok && res?.url && res?.token);
      logLiveKitTokenResult({
        source: input.source || "fetch",
        roomName,
        identity,
        canPublish: wantsPublish,
        ok,
        cacheHit: false,
        error: ok ? undefined : String(res?.error || ""),
      });

      if (!ok) return null;

      logLiveKitTokenClaims(String(res.token), {
        source: input.source || "fetch",
        roomName,
        requestIdentity: identity,
      });

      const entry = {
        url: String(res.url),
        token: String(res.token),
        fetchedAt: Date.now(),
      };
      writeCache(key, entry);
      return entry;
    } catch (e: any) {
      logLiveKitTokenResult({
        source: input.source || "fetch",
        roomName,
        identity,
        canPublish: wantsPublish,
        ok: false,
        cacheHit: false,
        message: String(e?.message || e),
      });
      return null;
    } finally {
      writeInflight(key, null);
    }
  })();

  writeInflight(key, promise);
  const entry = await promise;
  return entry ? { url: entry.url, token: entry.token } : null;
}
