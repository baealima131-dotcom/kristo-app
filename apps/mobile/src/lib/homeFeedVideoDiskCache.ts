import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  collectHomeFeedVideoDiskCacheUrls,
  collectVideoFeedIndexes,
  resolveActiveVideoRank,
  resolveHomeFeedRowPlaybackUrl,
  shouldRetainHomeFeedVideoDiskCache,
} from "@/src/lib/homeFeedVideoWindow";
import { hashMediaUrl } from "@/src/lib/mediaPosterCache";

const STORAGE_KEY = "kristo_home_feed_video_disk_cache_v1";
const VIDEO_DISK_DIR = `${FileSystem.cacheDirectory || ""}home-feed-videos/`;

const MAX_CONCURRENT_DOWNLOADS = 2;
const DOWNLOAD_TIMEOUT_MS = 120_000;

type DiskCacheEntry = {
  remoteUrl: string;
  localUri: string;
  savedAt: number;
  bytes?: number;
};

type DiskCacheIndex = {
  version: 1;
  entries: Record<string, DiskCacheEntry>;
};

const memory = new Map<string, DiskCacheEntry>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

let hydratePromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

function normalizeUrl(url: string) {
  return String(url || "").trim().split("?")[0];
}

function isNetworkUrl(url: string) {
  const trimmed = String(url || "").trim();
  return Boolean(trimmed) && /^https?:\/\//i.test(trimmed);
}

function cacheKey(url: string) {
  return hashMediaUrl(url);
}

function localFilePath(url: string) {
  const hash = cacheKey(url);
  if (!hash) return "";
  return `${VIDEO_DISK_DIR}${hash}.mp4`;
}

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function rememberEntry(entry: DiskCacheEntry) {
  const key = normalizeUrl(entry.remoteUrl);
  if (!key || !entry.localUri) return;
  memory.set(key, entry);
  schedulePersistIndex();
}

function schedulePersistIndex() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersistIndex();
  }, 300);
}

async function flushPersistIndex() {
  if (!persistDirty) return;
  persistDirty = false;
  try {
    const payload: DiskCacheIndex = {
      version: 1,
      entries: Object.fromEntries(memory.entries()),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

export async function persistHomeFeedVideoDiskCacheNow(): Promise<void> {
  persistDirty = true;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await flushPersistIndex();
}

async function readPersistedIndex(): Promise<DiskCacheIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiskCacheIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function ensureVideoDiskDir() {
  if (!VIDEO_DISK_DIR) return;
  await FileSystem.makeDirectoryAsync(VIDEO_DISK_DIR, { intermediates: true }).catch(() => {});
}

export async function hydrateHomeFeedVideoDiskCache(): Promise<void> {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    await ensureVideoDiskDir();
    const index = await readPersistedIndex();
    const before = memory.size;

    if (index?.entries) {
      for (const entry of Object.values(index.entries)) {
        if (!entry?.remoteUrl || !entry?.localUri) continue;
        const key = normalizeUrl(entry.remoteUrl);
        if (key && memory.has(key)) continue;
        try {
          const info = await FileSystem.getInfoAsync(entry.localUri);
          if (!info.exists) continue;
        } catch {
          continue;
        }
        rememberEntry(entry);
      }
    }

    console.log("KRISTO_VIDEO_DISK_CACHE_HYDRATED", {
      count: memory.size,
      added: Math.max(0, memory.size - before),
      indexEntries: index ? Object.keys(index.entries).length : 0,
    });
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

export function subscribeHomeFeedVideoDiskCache(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sync lookup — returns file:// URI when the remote URL is on disk. */
export function getCachedVideoUri(url: string): string | null {
  const remote = String(url || "").trim();
  if (!remote) return null;
  if (remote.startsWith("file://")) return remote;

  const key = normalizeUrl(remote);
  const entry = memory.get(key);
  return entry?.localUri ? String(entry.localUri).trim() : null;
}

/** Prefer local disk cache, otherwise the original remote URL. */
export function resolveHomeFeedPlaybackUri(remoteUrl: string): string {
  const remote = String(remoteUrl || "").trim();
  if (!remote) return "";
  return getCachedVideoUri(remote) || remote;
}

function collectWindowVideoUrls(rows: any[], activeIndex: number): string[] {
  return collectHomeFeedVideoDiskCacheUrls(rows, activeIndex);
}

async function deleteCachedEntry(key: string, entry: DiskCacheEntry) {
  memory.delete(key);
  schedulePersistIndex();
  try {
    await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
  } catch {}
  console.log("KRISTO_VIDEO_DISK_CACHE_EVICTED", {
    remoteUrl: entry.remoteUrl,
    localUri: entry.localUri,
  });
}

export async function cacheVideoUrl(url: string): Promise<string | null> {
  const remote = String(url || "").trim();
  const normalized = normalizeUrl(remote);
  if (!normalized || !isNetworkUrl(remote)) return null;

  const existing = getCachedVideoUri(remote);
  if (existing) return existing;

  const pending = inflight.get(normalized);
  if (pending) return pending;

  const job = (async () => {
    await hydrateHomeFeedVideoDiskCache();
    await ensureVideoDiskDir();

    const dest = localFilePath(remote);
    if (!dest) return null;

    try {
      const onDisk = await FileSystem.getInfoAsync(dest);
      if (onDisk.exists) {
        const localUri = dest.startsWith("file://") ? dest : `file://${dest}`;
        const entry: DiskCacheEntry = {
          remoteUrl: normalized,
          localUri: onDisk.uri || localUri,
          savedAt: Date.now(),
          bytes: typeof onDisk.size === "number" ? onDisk.size : undefined,
        };
        rememberEntry(entry);
        notifyListeners();
        void persistHomeFeedVideoDiskCacheNow();

        console.log("KRISTO_VIDEO_DISK_CACHE_HIT", {
          remoteUrl: normalized,
          localUri: entry.localUri,
          bytes: entry.bytes ?? null,
        });
        return entry.localUri;
      }
    } catch {}

    console.log("KRISTO_VIDEO_DISK_CACHE_DOWNLOAD_START", { remoteUrl: normalized });

    try {
      const result = (await Promise.race([
        FileSystem.downloadAsync(remote, dest),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("download-timeout")), DOWNLOAD_TIMEOUT_MS);
        }),
      ])) as FileSystem.FileSystemDownloadResult;

      const localUri = String(result?.uri || "").trim();
      if (!localUri) return null;

      const entry: DiskCacheEntry = {
        remoteUrl: normalized,
        localUri,
        savedAt: Date.now(),
        bytes: typeof result?.headers?.["Content-Length"] === "string"
          ? Number(result.headers["Content-Length"]) || undefined
          : undefined,
      };
      rememberEntry(entry);
      notifyListeners();
      await persistHomeFeedVideoDiskCacheNow();

      console.log("KRISTO_VIDEO_DISK_CACHE_READY", {
        remoteUrl: normalized,
        localUri,
        bytes: entry.bytes ?? null,
      });
      return localUri;
    } catch (error: any) {
      console.log("KRISTO_VIDEO_DISK_CACHE_DOWNLOAD_FAILED", {
        remoteUrl: normalized,
        error: String(error?.message || error || "download-failed"),
      });
      try {
        await FileSystem.deleteAsync(dest, { idempotent: true });
      } catch {}
      return null;
    }
  })();

  inflight.set(normalized, job);
  try {
    return await job;
  } finally {
    inflight.delete(normalized);
  }
}

async function runLimited<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<void> {
  if (!tasks.length) return;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        await tasks[index]();
      } catch {}
    }
  });

  await Promise.all(workers);
}

export function evictFarVideoCache(activeIndex: number, rows: any[]) {
  const evicted: string[] = [];

  for (const [key, entry] of memory.entries()) {
    if (shouldRetainHomeFeedVideoDiskCache(rows, activeIndex, entry.remoteUrl)) continue;
    evicted.push(key);
    void deleteCachedEntry(key, entry);
  }

  if (evicted.length) {
    console.log("KRISTO_VIDEO_DISK_CACHE_WINDOW_EVICT", {
      activeIndex,
      evicted: evicted.length,
      retained: memory.size,
    });
  }
}

/** Download active + next 3 + previous 2 videos to local file:// storage. */
export function prepareVideoDiskCacheWindow(rows: any[], activeIndex: number): void {
  void (async () => {
    await hydrateHomeFeedVideoDiskCache();

    const targets = collectWindowVideoUrls(rows, activeIndex);
    if (!targets.length) {
      evictFarVideoCache(activeIndex, rows);
      return;
    }

    console.log("KRISTO_VIDEO_DISK_CACHE_WINDOW_PREPARE", {
      activeIndex,
      count: targets.length,
      urls: targets.map(normalizeUrl),
    });

    await runLimited(
      targets.map((url) => () => cacheVideoUrl(url)),
      MAX_CONCURRENT_DOWNLOADS
    );

    evictFarVideoCache(activeIndex, rows);
  })();
}

/** Drop distant disk entries when the OS signals memory pressure. */
export function evictHomeFeedVideoDiskCacheOnMemoryPressure(
  rows: any[],
  activeIndex: number
): void {
  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return;

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const keep = new Set<string>();

  for (let rank = activeRank - 1; rank <= activeRank + 1; rank += 1) {
    if (rank < 0 || rank >= videoIndexes.length) continue;
    const row = rows[videoIndexes[rank]];
    if (!row) continue;
    const key = normalizeUrl(resolveHomeFeedRowPlaybackUrl(row));
    if (key) keep.add(key);
  }

  const evicted: string[] = [];
  for (const [key, entry] of memory.entries()) {
    if (keep.has(key)) continue;
    evicted.push(key);
    void deleteCachedEntry(key, entry);
  }

  if (evicted.length) {
    console.log("KRISTO_VIDEO_DISK_CACHE_MEMORY_EVICT", {
      activeIndex,
      evicted: evicted.length,
      retained: memory.size,
    });
  }
}

export function __resetHomeFeedVideoDiskCacheForTest() {
  memory.clear();
  inflight.clear();
  listeners.clear();
  hydratePromise = null;
  persistDirty = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
