import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  collectForwardVideoDiskCacheUrls,
  collectPrioritizedDiskCacheUrls,
  collectVideoFeedIndexes,
  resolveActiveVideoRank,
  resolveHomeFeedRowPlaybackUrl,
} from "@/src/lib/homeFeedVideoWindow";
import { computeHomeFeedPreloadAheadCount } from "@/src/lib/homeFeedVideoPreload";
import {
  isHomeFeedActiveFirstFrameReady,
  subscribeHomeFeedActiveFirstFrame,
} from "@/src/lib/homeFeedVideoReadiness";
import { hashMediaUrl } from "@/src/lib/mediaPosterCache";
import { isHomeFeedVideoDiskCacheEnabled } from "@/src/lib/homeFeedVideoMode";
import { shouldDeferBackgroundMediaJobs } from "@/src/lib/homeFeedWatchPlaybackPriority";

const STORAGE_KEY = "kristo_home_feed_video_disk_cache_v1";
const VIDEO_DISK_DIR = `${FileSystem.cacheDirectory || ""}home-feed-videos/`;

const WINDOW_CONCURRENCY = 2;
const BACKGROUND_CONCURRENCY = 1;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const BACKGROUND_START_FALLBACK_MS = 2500;

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

let queueGeneration = 0;
let queueRunning = false;
let backgroundUnblocked = false;
let backgroundUnblockWait: Promise<void> | null = null;
let pendingQueue: { rows: any[]; activeIndex: number } | null = null;

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

/** Network-first playback URI for inline Home Feed video. */
export function resolveHomeFeedNetworkPlaybackUri(remoteUrl: string): string {
  const remote = String(remoteUrl || "").trim();
  return remote;
}

/** Legacy helper — cache-first. Watch/modal surfaces may still use this. */
export function resolveHomeFeedPlaybackUri(remoteUrl: string): string {
  const remote = String(remoteUrl || "").trim();
  if (!remote) return "";
  return getCachedVideoUri(remote) || remote;
}

/** Returns a verified local file URI when the cache entry exists on disk. */
export async function getVerifiedCachedVideoUri(url: string): Promise<string | null> {
  const cached = getCachedVideoUri(url);
  if (!cached) return null;
  try {
    const info = await FileSystem.getInfoAsync(cached);
    if (!info.exists) return null;
    if (typeof info.size === "number" && info.size <= 0) return null;
    return cached;
  } catch {
    return null;
  }
}

export function isHomeFeedVideoDiskCached(url: string): boolean {
  return Boolean(getCachedVideoUri(url));
}

export function areHomeFeedForwardVideosDiskCached(rows: any[], activeIndex: number): boolean {
  const targets = collectForwardVideoDiskCacheUrls(rows, activeIndex);
  if (!targets.length) return true;
  return targets.every((url) => isHomeFeedVideoDiskCached(url));
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
  if (shouldDeferBackgroundMediaJobs()) return null;

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

function ensureBackgroundUnblockWait(): Promise<void> {
  if (backgroundUnblocked) return Promise.resolve();
  if (backgroundUnblockWait) return backgroundUnblockWait;

  backgroundUnblockWait = new Promise((resolve) => {
    const finish = () => {
      backgroundUnblocked = true;
      resolve();
    };

    if (isHomeFeedActiveFirstFrameReady()) {
      finish();
      return;
    }

    const unsub = subscribeHomeFeedActiveFirstFrame(() => {
      try {
        unsub();
      } catch {}
      clearTimeout(fallbackTimer);
      finish();
    });

    const fallbackTimer = setTimeout(() => {
      try {
        unsub();
      } catch {}
      finish();
    }, BACKGROUND_START_FALLBACK_MS);
  });

  return backgroundUnblockWait;
}

function buildDiskCacheQueue(rows: any[], activeIndex: number): {
  priorityUrls: string[];
  backgroundUrls: string[];
} {
  const seen = new Set<string>();
  const priorityUrls: string[] = [];
  const backgroundUrls: string[] = [];

  const addUnique = (url: string, bucket: string[]) => {
    const normalized = normalizeUrl(url);
    if (!normalized || !isNetworkUrl(url) || seen.has(normalized)) return;
    seen.add(normalized);
    bucket.push(url);
  };

  const visibleCount = Math.max(1, rows.length);
  const maxAhead = computeHomeFeedPreloadAheadCount(visibleCount);

  for (const url of collectPrioritizedDiskCacheUrls(rows, activeIndex)) {
    addUnique(url, priorityUrls);
  }

  for (const url of collectForwardVideoDiskCacheUrls(rows, activeIndex).slice(0, maxAhead)) {
    addUnique(url, backgroundUrls);
  }

  return { priorityUrls, backgroundUrls };
}

async function cacheUrlOrSkip(
  url: string,
  opts: { logBackgroundSkip?: boolean } = {}
): Promise<"cached" | "downloaded" | "skipped" | "failed"> {
  if (getCachedVideoUri(url)) {
    if (opts.logBackgroundSkip) {
      console.log("KRISTO_VIDEO_DISK_CACHE_BACKGROUND_SKIP_CACHED", {
        remoteUrl: normalizeUrl(url),
      });
    }
    return "skipped";
  }

  const result = await cacheVideoUrl(url);
  if (result) return "downloaded";
  if (getCachedVideoUri(url)) return "cached";
  return "failed";
}

async function runDiskCacheQueue(rows: any[], activeIndex: number, generation: number) {
  if (shouldDeferBackgroundMediaJobs()) return;

  await hydrateHomeFeedVideoDiskCache();
  if (generation !== queueGeneration) return;

  const { priorityUrls, backgroundUrls } = buildDiskCacheQueue(rows, activeIndex);

  console.log("KRISTO_VIDEO_DISK_CACHE_WINDOW_PREPARE", {
    activeIndex,
    priorityCount: priorityUrls.length,
    backgroundCount: backgroundUrls.length,
    mode: "near-window-only",
  });

  await runLimited(
    priorityUrls.map((url) => () => cacheUrlOrSkip(url)),
    WINDOW_CONCURRENCY
  );

  if (generation !== queueGeneration) return;

  await ensureBackgroundUnblockWait();
  if (generation !== queueGeneration) return;

  if (!backgroundUrls.length) {
    console.log("KRISTO_VIDEO_DISK_CACHE_BACKGROUND_ALL_READY", {
      activeIndex,
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    });
    return;
  }

  console.log("KRISTO_VIDEO_DISK_CACHE_BACKGROUND_ALL_START", {
    activeIndex,
    count: backgroundUrls.length,
    concurrency: BACKGROUND_CONCURRENCY,
  });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await runLimited(
    backgroundUrls.map((url) => async () => {
      if (generation !== queueGeneration) return;
      const outcome = await cacheUrlOrSkip(url, { logBackgroundSkip: true });
      if (outcome === "downloaded" || outcome === "cached") downloaded += 1;
      else if (outcome === "skipped") skipped += 1;
      else failed += 1;
    }),
    BACKGROUND_CONCURRENCY
  );

  if (generation !== queueGeneration) return;

  console.log("KRISTO_VIDEO_DISK_CACHE_BACKGROUND_ALL_READY", {
    activeIndex,
    total: backgroundUrls.length,
    downloaded,
    skipped,
    failed,
  });
}

/**
 * Schedule optional near-window disk cache (active + ~30% ahead only).
 */
export function scheduleHomeFeedVideoDiskCacheBackground(rows: any[], activeIndex: number): void {
  if (shouldDeferBackgroundMediaJobs()) return;
  if (!isHomeFeedVideoDiskCacheEnabled()) return;
  if (!Array.isArray(rows) || !rows.length) return;

  pendingQueue = { rows, activeIndex };
  queueGeneration += 1;
  void drainDiskCacheQueue();
}

async function drainDiskCacheQueue() {
  if (queueRunning) return;
  queueRunning = true;

  try {
    while (pendingQueue) {
      const job = pendingQueue;
      pendingQueue = null;
      const generation = queueGeneration;
      await runDiskCacheQueue(job.rows, job.activeIndex, generation);
      if (generation === queueGeneration) break;
    }
  } finally {
    queueRunning = false;
    if (pendingQueue) {
      void drainDiskCacheQueue();
    }
  }
}

/** @deprecated Use scheduleHomeFeedVideoDiskCacheBackground */
export function prepareVideoDiskCacheWindow(rows: any[], activeIndex: number): void {
  scheduleHomeFeedVideoDiskCacheBackground(rows, activeIndex);
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
  queueGeneration = 0;
  queueRunning = false;
  backgroundUnblocked = false;
  backgroundUnblockWait = null;
  pendingQueue = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
