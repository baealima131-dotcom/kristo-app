import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { loadChurchProfileCache } from "@/src/lib/churchStore";
import { getProfileScreenCache, peekChurchOverviewCache } from "@/src/lib/screenDataCache";
import { getSessionSync } from "@/src/lib/kristoSession";
import { homeFeedMediaUrl } from "@/src/lib/homeFeedVideoUri";

const STORAGE_KEY = "kristo_home_feed_avatar_cache_v1";
const AVATAR_DISK_DIR = `${String(Paths.cache.uri || "").replace(/\/$/, "")}/home-feed-avatars/`;

export type HomeFeedAvatarCacheEntry = {
  cacheKey: string;
  localUri: string;
  sourceUrl: string;
  sourceUpdatedAt?: number;
  savedAt: number;
};

type HomeFeedAvatarCacheIndex = {
  version: 1;
  entries: Record<string, HomeFeedAvatarCacheEntry>;
};

const memoryEntries = new Map<string, HomeFeedAvatarCacheEntry>();
const avatarDisplaySessionByKey = new Map<string, string>();
const inflightResolves = new Map<string, Promise<string | null>>();
const avatarListeners = new Map<string, Set<(uri: string | null) => void>>();
const avatarDiagnosticContextByKey = new Map<
  string,
  { churchId?: string; mediaId?: string; rowIndex?: number }
>();

let hydratePromise: Promise<void> | null = null;
let hydrateSessionReady = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

const appContainerRoot = (() => {
  const cacheUri = String(Paths.cache?.uri || "").trim();
  if (!cacheUri) return "";
  const match = cacheUri.match(/^(file:\/\/\/var\/mobile\/Containers\/Data\/Application\/[^/]+)/);
  return match?.[1] || cacheUri.replace(/\/Library\/.*$/, "");
})();

function hashString(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function homeFeedAvatarUrlCacheKey(remoteUrl: string): string {
  const normalized = String(remoteUrl || "").trim();
  if (!normalized) return "";
  return `url:${hashString(normalized.split("?")[0])}`;
}

export function homeFeedAvatarEntityCacheKey(kind: "church" | "user", id: string): string {
  const normalized = String(id || "").trim();
  if (!normalized) return "";
  if (kind === "church") return `church:${normalized.toUpperCase()}`;
  return `user:${normalized}`;
}

function isResolvableAvatarUri(uri: string): boolean {
  const value = String(uri || "").trim();
  if (!value) return false;
  if (!value.startsWith("file://")) return true;
  if (!appContainerRoot) return true;
  return value.startsWith(appContainerRoot);
}

function isDirectAvatarUri(uri: string): boolean {
  const value = String(uri || "").trim();
  return value.startsWith("data:image/") || value.startsWith("file://");
}

function normalizeRemoteAvatarUrl(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (trimmed.startsWith("file://")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return homeFeedMediaUrl(trimmed);
}

function entryIsFresh(entry: HomeFeedAvatarCacheEntry | undefined, sourceUpdatedAt?: number) {
  if (!entry) return false;
  const bust = Number(sourceUpdatedAt || 0);
  if (!bust) return true;
  const entryBust = Number(entry.sourceUpdatedAt || 0);
  if (!entryBust) return true;
  return entryBust >= bust;
}

function rememberMemoryEntry(entry: HomeFeedAvatarCacheEntry) {
  const key = String(entry.cacheKey || "").trim();
  const localUri = String(entry.localUri || "").trim();
  if (!key || !localUri || !isResolvableAvatarUri(localUri)) return;
  memoryEntries.set(key, entry);
  avatarDisplaySessionByKey.set(key, localUri);
}

function notifyAvatarListeners(cacheKey: string, uri: string | null) {
  const listeners = avatarListeners.get(cacheKey);
  if (!listeners?.size) return;
  for (const listener of listeners) {
    try {
      listener(uri);
    } catch {}
  }
}

const avatarLogOnce = new Set<string>();

function logAvatarOnce(event: string, cacheKey: string, payload: Record<string, unknown>) {
  const token = `${event}:${cacheKey}`;
  if (avatarLogOnce.has(token)) return;
  avatarLogOnce.add(token);
  console.log(event, { cacheKey, ...payload });
}

export function registerHomeFeedAvatarDiagnosticContext(
  cacheKey: string,
  context: { churchId?: string; mediaId?: string; rowIndex?: number }
) {
  const key = String(cacheKey || "").trim();
  if (!key) return;
  avatarDiagnosticContextByKey.set(key, context || {});
}

export function peekHomeFeedAvatarSession(cacheKey: string): string | null {
  const key = String(cacheKey || "").trim();
  if (!key) return null;
  const sessionUri = String(avatarDisplaySessionByKey.get(key) || "").trim();
  if (sessionUri && isResolvableAvatarUri(sessionUri)) return sessionUri;
  return null;
}

export function writeHomeFeedAvatarSession(cacheKey: string, localUri: string) {
  const key = String(cacheKey || "").trim();
  const uri = String(localUri || "").trim();
  if (!key || !uri || !isResolvableAvatarUri(uri)) return;
  avatarDisplaySessionByKey.set(key, uri);
}

/** Instant memory + session lookup — safe during first render. */
export function peekHomeFeedAvatar(cacheKey: string, sourceUpdatedAt?: number): string | null {
  const key = String(cacheKey || "").trim();
  if (!key) return null;

  const sessionUri = peekHomeFeedAvatarSession(key);
  if (sessionUri) {
    logAvatarOnce("KRISTO_HOME_FEED_AVATAR_CACHE_HIT", key, { localUri: sessionUri });
    return sessionUri;
  }

  const entry = memoryEntries.get(key);
  if (entry && entryIsFresh(entry, sourceUpdatedAt)) {
    const localUri = String(entry.localUri || "").trim();
    if (localUri && isResolvableAvatarUri(localUri)) {
      avatarDisplaySessionByKey.set(key, localUri);
      logAvatarOnce("KRISTO_HOME_FEED_AVATAR_CACHE_HIT", key, { localUri });
      return localUri;
    }
  }

  return null;
}

export function subscribeHomeFeedAvatarCache(
  cacheKey: string,
  listener: (uri: string | null) => void
): () => void {
  const key = String(cacheKey || "").trim();
  if (!key) return () => {};

  let listeners = avatarListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    avatarListeners.set(key, listeners);
  }
  listeners.add(listener);

  const existing = peekHomeFeedAvatar(key);
  if (existing) listener(existing);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      avatarListeners.delete(key);
    }
  };
}

function schedulePersistIndex() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersistIndex();
  }, 250);
}

async function flushPersistIndex() {
  if (!persistDirty) return;
  persistDirty = false;
  try {
    const payload: HomeFeedAvatarCacheIndex = {
      version: 1,
      entries: Object.fromEntries(memoryEntries.entries()),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

async function readPersistedIndex(): Promise<HomeFeedAvatarCacheIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeFeedAvatarCacheIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function hydrateHomeFeedAvatarCache(): Promise<void> {
  if (hydrateSessionReady) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const index = await readPersistedIndex();
    if (!index) {
      hydrateSessionReady = true;
      return;
    }

    for (const entry of Object.values(index.entries)) {
      if (!entry?.cacheKey || !entry?.localUri) continue;
      const localUri = String(entry.localUri || "").trim();
      if (!localUri) continue;
      if (localUri.startsWith("file://")) {
        try {
          const info = await FileSystem.getInfoAsync(localUri);
          if (!info.exists) continue;
        } catch {
          continue;
        }
      }
      rememberMemoryEntry(entry);
    }

    hydrateSessionReady = true;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

async function ensureAvatarDiskDir() {
  if (!AVATAR_DISK_DIR) return;
  await FileSystem.makeDirectoryAsync(AVATAR_DISK_DIR, { intermediates: true }).catch(() => {});
}

function avatarDiskPath(cacheKey: string, sourceUrl: string): string {
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9:_-]/g, "_");
  const ext = /\.png(?:\?|$)/i.test(sourceUrl) ? "png" : "jpg";
  return `${AVATAR_DISK_DIR}${safeKey}.${ext}`;
}

async function peekDiskAvatarEntry(
  cacheKey: string,
  sourceUpdatedAt?: number
): Promise<string | null> {
  const hadMemory = memoryEntries.has(cacheKey) || avatarDisplaySessionByKey.has(cacheKey);
  await hydrateHomeFeedAvatarCache();

  const entry = memoryEntries.get(cacheKey);
  if (!entry || !entryIsFresh(entry, sourceUpdatedAt)) return null;

  const localUri = String(entry.localUri || "").trim();
  if (!localUri || !isResolvableAvatarUri(localUri)) return null;

  if (localUri.startsWith("file://")) {
    try {
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) return null;
    } catch {
      return null;
    }
  }

  avatarDisplaySessionByKey.set(cacheKey, localUri);
  if (!hadMemory) {
    logAvatarOnce("KRISTO_HOME_FEED_AVATAR_DISK_HIT", cacheKey, {
      localUri,
      sourceUrl: entry.sourceUrl || null,
    });
  }
  return localUri;
}

async function collectSupplementalRemoteUrls(cacheKey: string): Promise<string[]> {
  const urls: string[] = [];
  const push = (raw: unknown) => {
    const uri = normalizeRemoteAvatarUrl(String(raw || ""));
    if (!uri || urls.includes(uri)) return;
    urls.push(uri);
  };

  if (cacheKey.startsWith("church:")) {
    const churchId = cacheKey.slice("church:".length);
    const session = getSessionSync() as { userId?: string } | null;
    const userId = String(session?.userId || "").trim();
    const overview = userId ? peekChurchOverviewCache(churchId, userId) : null;
    push(overview?.profile?.avatarUri);
    const profile = await loadChurchProfileCache(churchId);
    push(profile?.avatarUri);
    push(profile?.avatarUrl);
  } else if (cacheKey.startsWith("user:")) {
    const userId = cacheKey.slice("user:".length);
    const profile = await getProfileScreenCache(userId);
    push(profile?.profile?.avatarUri);
    push(profile?.profile?.avatarUrl);
  }

  return urls;
}

async function downloadRemoteAvatar(cacheKey: string, remoteUrl: string): Promise<string | null> {
  const sourceUrl = normalizeRemoteAvatarUrl(remoteUrl);
  if (!sourceUrl) return null;

  if (isDirectAvatarUri(sourceUrl)) {
    return sourceUrl;
  }

  if (!/^https?:\/\//i.test(sourceUrl)) return null;

  await ensureAvatarDiskDir();
  const dest = avatarDiskPath(cacheKey, sourceUrl);
  try {
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) return dest;
  } catch {}

  try {
    const result = await FileSystem.downloadAsync(sourceUrl, dest);
    const statusCode = Number((result as any)?.status || 0);
    if (statusCode >= 400) {
      const ctx = avatarDiagnosticContextByKey.get(cacheKey);
      console.log("KRISTO_HOME_FEED_AVATAR_404", {
        churchId: ctx?.churchId || null,
        mediaId: ctx?.mediaId || null,
        avatarUri: "present",
        source: "network",
        rowIndex: ctx?.rowIndex ?? null,
        statusCode,
      });
      return null;
    }
    const uri = String(result?.uri || dest).trim();
    return uri && isResolvableAvatarUri(uri) ? uri : null;
  } catch {
    const ctx = avatarDiagnosticContextByKey.get(cacheKey);
    console.log("KRISTO_HOME_FEED_AVATAR_404", {
      churchId: ctx?.churchId || null,
      mediaId: ctx?.mediaId || null,
      avatarUri: "present",
      source: "network",
      rowIndex: ctx?.rowIndex ?? null,
      statusCode: null,
    });
    return null;
  }
}

async function rememberResolvedAvatar(params: {
  cacheKey: string;
  localUri: string;
  sourceUrl: string;
  sourceUpdatedAt?: number;
}): Promise<string> {
  const cacheKey = String(params.cacheKey || "").trim();
  const localUri = String(params.localUri || "").trim();
  const sourceUrl = String(params.sourceUrl || "").trim();
  if (!cacheKey || !localUri) return localUri;

  rememberMemoryEntry({
    cacheKey,
    localUri,
    sourceUrl: sourceUrl || localUri,
    sourceUpdatedAt: params.sourceUpdatedAt,
    savedAt: Date.now(),
  });
  schedulePersistIndex();
  notifyAvatarListeners(cacheKey, localUri);
  return localUri;
}

async function resolveHomeFeedAvatarNetwork(
  cacheKey: string,
  remoteUrls: string[],
  sourceUpdatedAt?: number
): Promise<string | null> {
  const candidates = remoteUrls
    .map((raw) => normalizeRemoteAvatarUrl(raw))
    .filter((uri, index, list) => uri && list.indexOf(uri) === index);

  const supplemental = await collectSupplementalRemoteUrls(cacheKey);
  for (const uri of supplemental) {
    if (!candidates.includes(uri)) candidates.push(uri);
  }

  if (!candidates.length) return null;

  console.log("KRISTO_HOME_FEED_AVATAR_NETWORK_START", {
    cacheKey,
    candidateCount: candidates.length,
  });

  for (const remoteUrl of candidates) {
    const localUri = await downloadRemoteAvatar(cacheKey, remoteUrl);
    if (!localUri) continue;

    logAvatarOnce("KRISTO_HOME_FEED_AVATAR_NETWORK_SUCCESS", cacheKey, {
      sourceUrl: remoteUrl,
      localUri,
    });

    return rememberResolvedAvatar({
      cacheKey,
      localUri,
      sourceUrl: remoteUrl,
      sourceUpdatedAt,
    });
  }

  logAvatarOnce("KRISTO_HOME_FEED_AVATAR_NETWORK_FAILED", cacheKey, {
    candidateCount: candidates.length,
  });
  return null;
}

export async function ensureHomeFeedAvatar(params: {
  cacheKey: string;
  remoteUrls: string[];
  sourceUpdatedAt?: number;
}): Promise<string | null> {
  const cacheKey = String(params.cacheKey || "").trim();
  if (!cacheKey) return null;

  const sync = peekHomeFeedAvatar(cacheKey, params.sourceUpdatedAt);
  if (sync) return sync;

  const existingInflight = inflightResolves.get(cacheKey);
  if (existingInflight) return existingInflight;

  const task = (async () => {
    const diskUri = await peekDiskAvatarEntry(cacheKey, params.sourceUpdatedAt);
    if (diskUri) return diskUri;

    const networkUri = await resolveHomeFeedAvatarNetwork(
      cacheKey,
      params.remoteUrls,
      params.sourceUpdatedAt
    );
    if (networkUri) return networkUri;

    logAvatarOnce("KRISTO_HOME_FEED_AVATAR_FALLBACK", cacheKey, {});
    notifyAvatarListeners(cacheKey, null);
    return null;
  })().finally(() => {
    inflightResolves.delete(cacheKey);
  });

  inflightResolves.set(cacheKey, task);
  return task;
}
