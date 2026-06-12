import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { Image } from "react-native";
import {
  onBackgroundMediaJobsResumed,
  shouldDeferBackgroundMediaJobs,
} from "@/src/lib/homeFeedWatchPlaybackPriority";

const STORAGE_KEY = "kristo_media_poster_cache_v1";
const POSTER_DISK_DIR = `${FileSystem.cacheDirectory || ""}media-posters/`;

export type MediaPosterSource = "static" | "generated" | "remote" | "server";

export type MediaPosterCacheEntry = {
  postId: string;
  videoUrl: string;
  videoUrlHash: string;
  posterUri: string;
  source: MediaPosterSource;
  savedAt: number;
  captureTimeMs?: number;
};

type MediaPosterCacheIndex = {
  version: 1;
  entries: Record<string, MediaPosterCacheEntry>;
};

const memoryEntries = new Map<string, MediaPosterCacheEntry>();
const videoUrlPosterEntries = new Map<string, string>();
const prefetchedUris = new Set<string>();
const posterListeners = new Map<string, Set<(posterUri: string) => void>>();
let hydratePromise: Promise<void> | null = null;
let hydrateSessionReady = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;
let deferredHydrateRequested = false;

function normalizeVideoUrl(videoUrl: string) {
  return String(videoUrl || "").trim().split("?")[0];
}

export function hashMediaUrl(videoUrl: string): string {
  const raw = normalizeVideoUrl(videoUrl);
  if (!raw) return "";
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function mediaPosterCacheKey(postId: string, videoUrl: string) {
  const id = String(postId || "").trim();
  const hash = hashMediaUrl(videoUrl);
  if (!id || !hash) return "";
  return `${id}:${hash}`;
}

function entryMatchesVideo(entry: MediaPosterCacheEntry | undefined, videoUrl: string) {
  if (!entry) return false;
  return normalizeVideoUrl(entry.videoUrl) === normalizeVideoUrl(videoUrl);
}

function rememberMemoryEntry(entry: MediaPosterCacheEntry) {
  const key = mediaPosterCacheKey(entry.postId, entry.videoUrl);
  if (!key || !entry.posterUri) return;
  memoryEntries.set(key, entry);
}

function notifyPosterListeners(postId: string, videoUrl: string, posterUri: string) {
  const key = mediaPosterCacheKey(postId, videoUrl);
  if (!key || !posterUri) return;
  const listeners = posterListeners.get(key);
  if (!listeners?.size) return;
  for (const listener of listeners) {
    try {
      listener(posterUri);
    } catch {}
  }
}

/** Subscribe to poster cache writes for a post — fires immediately when cached. */
export function subscribeMediaPosterCache(
  postId: string,
  videoUrl: string,
  listener: (posterUri: string) => void
): () => void {
  const key = mediaPosterCacheKey(postId, videoUrl);
  if (!key) return () => {};

  let listeners = posterListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    posterListeners.set(key, listeners);
  }
  listeners.add(listener);

  const existing = peekCachedMediaPoster(postId, videoUrl);
  if (existing) listener(existing);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      posterListeners.delete(key);
    }
  };
}

function schedulePersistIndex() {
  persistDirty = true;
  if (shouldDeferBackgroundMediaJobs()) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersistIndex();
  }, 250);
}

export function flushDeferredMediaPosterCacheWork() {
  if (shouldDeferBackgroundMediaJobs()) return;
  if (deferredHydrateRequested) {
    deferredHydrateRequested = false;
    void hydrateMediaPosterCache();
  }
  if (persistDirty && !persistTimer) {
    schedulePersistIndex();
  }
}

onBackgroundMediaJobsResumed(flushDeferredMediaPosterCacheWork);

async function flushPersistIndex() {
  if (shouldDeferBackgroundMediaJobs()) return;
  if (!persistDirty) return;
  persistDirty = false;
  try {
    const payload: MediaPosterCacheIndex = {
      version: 1,
      entries: Object.fromEntries(memoryEntries.entries()),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

async function readPersistedIndex(): Promise<MediaPosterCacheIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MediaPosterCacheIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function hydrateMediaPosterCache(): Promise<void> {
  if (hydrateSessionReady) {
    console.log("KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY", {
      count: memoryEntries.size,
    });
    return;
  }
  if (shouldDeferBackgroundMediaJobs()) {
    deferredHydrateRequested = true;
    return;
  }
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const index = await readPersistedIndex();
    if (!index) {
      hydrateSessionReady = true;
      return;
    }

    for (const entry of Object.values(index.entries)) {
      if (!entry?.postId || !entry?.posterUri || !entry?.videoUrl) continue;

      const posterUri = String(entry.posterUri || "").trim();
      if (posterUri.startsWith("file://")) {
        try {
          const info = await FileSystem.getInfoAsync(posterUri);
          if (!info.exists) continue;
        } catch {
          continue;
        }
      }

      rememberMemoryEntry(entry);
      rememberVideoUrlPoster(entry.videoUrl, entry.posterUri);
    }

    hydrateSessionReady = true;
    console.log("KRISTO_MEDIA_POSTER_CACHE_HYDRATED", {
      count: memoryEntries.size,
    });
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

function rememberVideoUrlPoster(videoUrl: string, posterUri: string) {
  const normalizedVideoUrl = normalizeVideoUrl(videoUrl);
  const normalizedPosterUri = String(posterUri || "").trim();
  if (!normalizedVideoUrl || !normalizedPosterUri) return;
  videoUrlPosterEntries.set(normalizedVideoUrl, normalizedPosterUri);
}

/** Instant lookup by video URL when postId is missing or mismatched. */
export function peekCachedMediaPosterByVideoUrl(videoUrl: string): string | null {
  const normalizedVideoUrl = normalizeVideoUrl(videoUrl);
  if (!normalizedVideoUrl) return null;

  const direct = videoUrlPosterEntries.get(normalizedVideoUrl);
  if (direct) return direct;

  for (const entry of memoryEntries.values()) {
    if (normalizeVideoUrl(entry.videoUrl) === normalizedVideoUrl) {
      const posterUri = String(entry.posterUri || "").trim();
      if (posterUri) return posterUri;
    }
  }

  return null;
}

/** Prefer postId+videoUrl cache, then fall back to videoUrl-only. */
export function resolveCachedMediaPoster(postId: string, videoUrl: string): string | null {
  const byPost = peekCachedMediaPoster(postId, videoUrl);
  if (byPost) return byPost;
  return peekCachedMediaPosterByVideoUrl(videoUrl);
}

export function logMediaPosterCacheHit(params: {
  postId: string;
  videoUrl: string;
  posterUri: string;
}) {
  console.log("KRISTO_VIDEO_POSTER_CACHE_HIT", {
    postId: params.postId || null,
    videoUrl: normalizeVideoUrl(params.videoUrl) || null,
    posterUri: params.posterUri || null,
  });
}

/** Instant memory lookup — safe during first render. */
export function peekCachedMediaPoster(postId: string, videoUrl: string): string | null {
  const key = mediaPosterCacheKey(postId, videoUrl);
  if (!key) return null;
  const entry = memoryEntries.get(key);
  if (!entryMatchesVideo(entry, videoUrl)) return null;
  return String(entry?.posterUri || "").trim() || null;
}

export function peekCachedMediaPosterCaptureTimeMs(
  postId: string,
  videoUrl: string
): number | undefined {
  const key = mediaPosterCacheKey(postId, videoUrl);
  if (!key) return undefined;
  const entry = memoryEntries.get(key);
  if (!entryMatchesVideo(entry, videoUrl)) return undefined;
  const captureTimeMs = Number(entry?.captureTimeMs || 0);
  return Number.isFinite(captureTimeMs) && captureTimeMs > 0 ? captureTimeMs : undefined;
}

export async function getCachedMediaPoster(postId: string, videoUrl: string): Promise<string | null> {
  const sync = resolveCachedMediaPoster(postId, videoUrl);
  if (sync) return sync;

  await hydrateMediaPosterCache();
  return resolveCachedMediaPoster(postId, videoUrl);
}

async function ensurePosterDiskDir() {
  if (!POSTER_DISK_DIR) return;
  await FileSystem.makeDirectoryAsync(POSTER_DISK_DIR, { intermediates: true }).catch(() => {});
}

export async function persistPosterFileToDisk(params: {
  postId: string;
  videoUrl: string;
  sourceUri: string;
}): Promise<string> {
  const postId = String(params.postId || "").trim();
  const sourceUri = String(params.sourceUri || "").trim();
  const hash = hashMediaUrl(params.videoUrl);
  if (!postId || !hash || !sourceUri) return sourceUri;

  if (!sourceUri.startsWith("file://") || !POSTER_DISK_DIR) {
    return sourceUri;
  }

  await ensurePosterDiskDir();
  const dest = `${POSTER_DISK_DIR}${postId}_${hash}.jpg`;
  try {
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) return dest;
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    return dest;
  } catch {
    return sourceUri;
  }
}

export async function rememberMediaPoster(params: {
  postId?: string;
  videoUrl: string;
  posterUri: string;
  source: MediaPosterSource;
  persistFile?: boolean;
  captureTimeMs?: number;
}): Promise<string> {
  const postId = String(params.postId || "").trim();
  const videoUrl = normalizeVideoUrl(params.videoUrl);
  let posterUri = String(params.posterUri || "").trim();
  if (!videoUrl || !posterUri) return posterUri;

  const deferHeavyWork = shouldDeferBackgroundMediaJobs();

  if (postId && params.persistFile !== false && posterUri.startsWith("file://") && !deferHeavyWork) {
    posterUri = await persistPosterFileToDisk({ postId, videoUrl, sourceUri: posterUri });
  }

  rememberVideoUrlPoster(videoUrl, posterUri);

  if (postId) {
    const captureTimeMs = Number(params.captureTimeMs || 0);
    const entry: MediaPosterCacheEntry = {
      postId,
      videoUrl,
      videoUrlHash: hashMediaUrl(videoUrl),
      posterUri,
      source: params.source,
      savedAt: Date.now(),
      ...(Number.isFinite(captureTimeMs) && captureTimeMs > 0 ? { captureTimeMs } : {}),
    };

    rememberMemoryEntry(entry);
    if (!deferHeavyWork) {
      schedulePersistIndex();
      notifyPosterListeners(postId, videoUrl, posterUri);
    }
  }

  if (!deferHeavyWork) {
    prefetchMediaPosterImages([posterUri]);
  }

  if (!deferHeavyWork) {
    console.log("KRISTO_MEDIA_POSTER_CACHE_SAVED", {
      postId: postId || null,
      videoUrlHash: hashMediaUrl(videoUrl),
      source: params.source,
      posterUri,
    });
  }

  return posterUri;
}

export function prefetchMediaPosterImages(uris: string[]) {
  if (shouldDeferBackgroundMediaJobs()) return;
  for (const raw of uris) {
    const uri = String(raw || "").trim();
    if (!uri || prefetchedUris.has(uri)) continue;
    prefetchedUris.add(uri);
    Image.prefetch(uri).catch(() => {
      prefetchedUris.delete(uri);
    });
  }
}

export function collectMediaPosterPrefetchUris(
  items: any[],
  startIndex = 0,
  count = 8
): string[] {
  const end = Math.min(items.length, startIndex + count);
  const uris: string[] = [];

  for (let i = startIndex; i < end; i += 1) {
    const item = items[i];
    const postId = String(item?.id || "").trim();
    const videoUrl = String(item?.videoUrl || "").trim();
    const cached = resolveCachedMediaPoster(postId, videoUrl);
    if (cached) {
      uris.push(cached);
      continue;
    }

    for (const field of [
      item?.thumbnailUrl,
      item?.thumbnailUri,
      item?.posterUrl,
      item?.posterUri,
      item?.videoPosterUri,
      item?.coverUrl,
      item?.firstFrameUrl,
    ]) {
      const value = String(field || "").trim();
      if (value && !value.startsWith("kristo:")) {
        uris.push(value);
      }
    }
  }

  return [...new Set(uris.filter(Boolean))];
}

export async function warmMediaPosterCacheForItems(
  items: any[],
  startIndex = 0,
  count = 8
) {
  if (shouldDeferBackgroundMediaJobs()) return;
  await hydrateMediaPosterCache();
  const uris = collectMediaPosterPrefetchUris(items, startIndex, count);
  prefetchMediaPosterImages(uris);
}

export function exportMediaPosterCacheSnapshot(): Record<string, MediaPosterCacheEntry> {
  return Object.fromEntries(memoryEntries.entries());
}

export function importMediaPosterCacheSnapshot(entries: Record<string, MediaPosterCacheEntry>) {
  for (const entry of Object.values(entries || {})) {
    if (!entry?.posterUri || !entry?.videoUrl) continue;
    if (entry.postId) {
      rememberMemoryEntry(entry);
    }
    rememberVideoUrlPoster(entry.videoUrl, entry.posterUri);
  }
  schedulePersistIndex();
}

void hydrateMediaPosterCache();
