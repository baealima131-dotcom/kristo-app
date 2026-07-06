import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSessionSync } from "@/src/lib/kristoSession";
import { feedRenderKey } from "@/src/components/homeFeed/homeFeedRowKeys";
import { dedupeHomeFeedRowsByKey } from "@/src/components/homeFeed/homeFeedPagination";
import { clearHomeFeedYoutubeStreamSession } from "@/src/lib/homeFeedYoutubeStreamSession";
import {
  expandHomeFeedPageCacheRows,
  slimHomeFeedPageCacheRows,
  summarizeHomeFeedPageCacheRowBytes,
} from "@/src/components/homeFeed/homeFeedPageCacheRow";
import type { HomeFeedPagingState } from "./homeFeedRowsCache";

function normalizeHomeFeedApiRowLazy(row: any) {
  const { normalizeHomeFeedApiRow } = require("@/src/components/homeFeed/homeFeedUtils") as {
    normalizeHomeFeedApiRow: (input: any) => any;
  };
  return normalizeHomeFeedApiRow(row);
}

const META_PREFIX = "kristo_home_feed_pages_meta_v3:";
const PAGE_PREFIX = "kristo_home_feed_page_v3:";
const ROW_PREFIX = "kristo_home_feed_row_v1:";
const PAGE0_BUNDLE_PREFIX = "kristo_home_feed_page0_bundle_v1:";
const LEGACY_ROWS_PREFIX = "kristo_home_feed_rows_v1:";
const LEGACY_META_V2_PREFIX = "kristo_home_feed_pages_meta_v2:";
const LEGACY_PAGE_V2_PREFIX = "kristo_home_feed_page_v2:";

/** Bump when media-only filter rules change — invalidates entire on-disk page cache. */
export const HOME_FEED_PAGE_CACHE_MEDIA_FILTER_VERSION = 4;

/** YouTube stream: first paint batch — target 20 session rows. */
export const HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE = 20;

/** YouTube stream: subsequent API/disk page size. */
export const HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE = 20;

/** Cold-start skeleton placeholders before page 0 paints. */
export const HOME_FEED_YOUTUBE_SKELETON_COUNT = 5;

/** Bottom-of-feed skeleton rows while the next page loads. */
export const HOME_FEED_YOUTUBE_BOTTOM_SKELETON_COUNT = 3;

/** Prefetch when this many rows remain below the active index. */
export const HOME_FEED_YOUTUBE_PREFETCH_REMAINING = 3;

export type HomeFeedPageCacheMeta = {
  userId: string;
  churchId: string;
  pageSize: number;
  firstPageSize?: number;
  mediaFilterVersion?: number;
  savedPageCount: number;
  nextCursor: string | null;
  hasMore: boolean;
  savedAt: number;
  snapshotRowIds?: string[];
  /** Per-page row count when stored as one AsyncStorage key per row. */
  pageRowCounts?: number[];
};

type HomeFeedPagePayload = {
  pageIndex: number;
  rows: any[];
  savedAt: number;
};

const HOME_FEED_PAGE_CACHE_SNAPSHOT_ID_CAP = 60;

const loadedPagesMem = new Map<number, any[]>();
let metaMem: HomeFeedPageCacheMeta | null = null;
let page0HydrateInflight: Promise<any[] | null> | null = null;
let lastPage0HydrateUserId = "";

function activeUserId() {
  return String(getSessionSync()?.userId || "guest").trim() || "guest";
}

function metaStorageKey(userId: string) {
  return `${META_PREFIX}${userId}`;
}

function pageStorageKey(userId: string, pageIndex: number) {
  return `${PAGE_PREFIX}${userId}:${pageIndex}`;
}

function pageRowStorageKey(userId: string, pageIndex: number, rowIndex: number) {
  return `${ROW_PREFIX}${userId}:${pageIndex}:${rowIndex}`;
}

function page0BundleStorageKey(userId: string) {
  return `${PAGE0_BUNDLE_PREFIX}${userId}`;
}

function homeFeedPageCacheKeyPrefixes(userId: string) {
  return [
    `${META_PREFIX}${userId}`,
    `${PAGE_PREFIX}${userId}:`,
    `${ROW_PREFIX}${userId}:`,
    `${PAGE0_BUNDLE_PREFIX}${userId}`,
    `${LEGACY_ROWS_PREFIX}${userId}`,
    `${LEGACY_META_V2_PREFIX}${userId}`,
    `${LEGACY_PAGE_V2_PREFIX}${userId}:`,
  ];
}

function legacyRowsStorageKey(userId: string) {
  return `${LEGACY_ROWS_PREFIX}${userId}`;
}

function filterYoutubeVideoRowsLazy(rows: any[]): any[] {
  const { isHomeFeedYouTubeStyleVideo } = require("@/src/lib/homeFeedVideoMode") as {
    isHomeFeedYouTubeStyleVideo: () => boolean;
  };
  if (!isHomeFeedYouTubeStyleVideo()) return rows;
  const { filterHomeFeedYoutubeStreamRows } = require("@/src/components/homeFeed/homeFeedUtils") as {
    filterHomeFeedYoutubeStreamRows: (input: any[]) => any[];
  };
  return filterHomeFeedYoutubeStreamRows(rows);
}

function isDeletedCachedRow(row: any): boolean {
  if (!row || typeof row !== "object") return true;
  if (row.deleted === true) return true;
  if (String(row.deletedAt || "").trim()) return true;
  const status = String(row.status || row.scheduleStatus || "")
    .trim()
    .toLowerCase();
  return status === "deleted";
}

function normalizeCachedRows(rows: unknown): any[] {
  if (!Array.isArray(rows)) return [];
  const normalized = rows
    .filter((row) => row && typeof row === "object")
    .filter((row) => !isDeletedCachedRow(row))
    .map((row) => normalizeHomeFeedApiRowLazy(row));
  return filterYoutubeVideoRowsLazy(normalized);
}

function hydrateCachedRowsFromDisk(rows: unknown): any[] {
  if (!Array.isArray(rows)) return [];
  const expanded = expandHomeFeedPageCacheRows(rows).filter((row) => !isDeletedCachedRow(row));
  return filterYoutubeVideoRowsLazy(expanded);
}

export function homeFeedYoutubeStreamLimitForPage(pageIndex: number): number {
  return pageIndex <= 0 ? HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE : HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE;
}

export function homeFeedYoutubeStreamOffsetForPage(pageIndex: number): number {
  if (pageIndex <= 0) return 0;
  return (
    HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE +
    (pageIndex - 1) * HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE
  );
}

function splitRowsIntoYoutubePages(allRows: any[]): any[][] {
  if (!allRows.length) return [];
  const pages: any[][] = [];
  pages.push(allRows.slice(0, HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE));
  let offset = HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE;
  while (offset < allRows.length) {
    pages.push(allRows.slice(offset, offset + HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE));
    offset += HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE;
  }
  return pages.filter((page) => page.length > 0);
}

async function rebuildYoutubePageCacheLayout(
  userId: string,
  meta: HomeFeedPageCacheMeta
): Promise<HomeFeedPageCacheMeta> {
  const allRows: any[] = [];
  for (let pageIndex = 0; pageIndex < meta.savedPageCount; pageIndex += 1) {
    const raw = await AsyncStorage.getItem(pageStorageKey(userId, pageIndex));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as HomeFeedPagePayload;
      allRows.push(...hydrateCachedRowsFromDisk(parsed?.rows));
    } catch {
      // skip corrupt page
    }
  }

  const pages = splitRowsIntoYoutubePages(allRows);
  if (!pages.length) return meta;

  const pageRowCounts: number[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const writeResult = await writePageToDisk(userId, pageIndex, pages[pageIndex], meta);
    pageRowCounts[pageIndex] = writeResult.rowCount;
    loadedPagesMem.set(pageIndex, pages[pageIndex]);
  }

  const nextMeta: HomeFeedPageCacheMeta = {
    ...meta,
    pageSize: HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE,
    firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
    mediaFilterVersion: HOME_FEED_PAGE_CACHE_MEDIA_FILTER_VERSION,
    savedPageCount: pages.length,
    pageRowCounts,
    savedAt: Date.now(),
  };
  await writeMetaToDisk(nextMeta);

  console.log("KRISTO_HOME_FEED_PAGE_CACHE_REBUILD", {
    totalRows: allRows.length,
    savedPageCount: pages.length,
    firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
    pageSize: HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE,
  });

  return nextMeta;
}

function needsYoutubePageCacheRebuild(meta: HomeFeedPageCacheMeta): boolean {
  return (
    meta.mediaFilterVersion !== HOME_FEED_PAGE_CACHE_MEDIA_FILTER_VERSION ||
    meta.firstPageSize !== HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE ||
    meta.pageSize !== HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE
  );
}

async function discardLegacyYoutubePageCacheKeys(userId: string) {
  const legacyMeta = await AsyncStorage.getItem(`${LEGACY_META_V2_PREFIX}${userId}`);
  if (!legacyMeta) return;
  try {
    const parsed = JSON.parse(legacyMeta) as HomeFeedPageCacheMeta;
    const keys = [`${LEGACY_META_V2_PREFIX}${userId}`];
    const pageCount = parsed?.savedPageCount ?? 0;
    for (let i = 0; i < pageCount; i += 1) {
      keys.push(`${LEGACY_PAGE_V2_PREFIX}${userId}:${i}`);
    }
    await AsyncStorage.multiRemove(keys);
    console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD_LEGACY", {
      userId,
      from: "v2",
      savedPageCount: pageCount,
    });
  } catch {
    await AsyncStorage.removeItem(`${LEGACY_META_V2_PREFIX}${userId}`);
  }
}

export async function ensureHomeFeedYoutubePageCacheValid(userId?: string): Promise<boolean> {
  const uid = String(userId || activeUserId()).trim() || "guest";
  await discardLegacyYoutubePageCacheKeys(uid);

  const meta = metaMem?.userId === uid ? metaMem : await readMetaFromDisk(uid);
  if (!meta) return true;

  if (needsYoutubePageCacheRebuild(meta)) {
    await clearHomeFeedPageCache(uid);
    console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD", {
      userId: uid,
      reason: "media-filter-or-layout-changed",
      previousFilterVersion: meta.mediaFilterVersion ?? null,
      previousFirstPageSize: meta.firstPageSize ?? null,
      previousSavedPageCount: meta.savedPageCount,
    });
    return false;
  }

  const page0RowCount = pageRowCountForMeta(meta, 0);
  if (
    page0RowCount > 0 &&
    page0RowCount < HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE &&
    effectiveStreamHasMore(meta, 1)
  ) {
    await clearHomeFeedPageCache(uid);
    console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD", {
      userId: uid,
      reason: "sparse-page0",
      page0Count: page0RowCount,
      target: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
    });
    return false;
  }

  if (page0RowCount <= 0) {
    const page0 = await readPageFromDisk(uid, 0);
    if (
      page0 &&
      page0.length < HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE &&
      effectiveStreamHasMore(meta, 1)
    ) {
      await clearHomeFeedPageCache(uid);
      console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD", {
        userId: uid,
        reason: "sparse-page0-legacy",
        page0Count: page0.length,
        target: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
      });
      return false;
    }
  }

  return true;
}

export function buildHomeFeedSkeletonRows(count = HOME_FEED_YOUTUBE_SKELETON_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    __homeFeedSkeleton: true,
    id: `home-feed-skeleton-${index}`,
  }));
}

export function isHomeFeedSkeletonRow(row: any): boolean {
  return row?.__homeFeedSkeleton === true;
}

export function homeFeedYoutubeStreamRemaining(activeIndex: number, totalRows: number): number {
  if (totalRows <= 0) return 0;
  return Math.max(0, totalRows - 1 - activeIndex);
}

/** Prefetch when scroll position is within this many px of list bottom. */
export const HOME_FEED_YOUTUBE_PREFETCH_DISTANCE_PX = 900;

export type HomeFeedYoutubeScrollMetrics = {
  scrollY: number;
  contentHeight: number;
  viewportHeight: number;
};

export function youtubeStreamDistanceFromEnd(metrics: HomeFeedYoutubeScrollMetrics): number {
  const { scrollY, contentHeight, viewportHeight } = metrics;
  return contentHeight - (scrollY + viewportHeight);
}

/** YouTube stream pagination: distance from bottom, not activeIndex. */
export function shouldPrefetchHomeFeedYoutubeStreamByScroll(
  metrics: HomeFeedYoutubeScrollMetrics
): boolean {
  if (metrics.contentHeight <= 0 || metrics.viewportHeight <= 0) return false;
  return youtubeStreamDistanceFromEnd(metrics) < HOME_FEED_YOUTUBE_PREFETCH_DISTANCE_PX;
}

/** @deprecated YouTube stream uses scroll distance — see shouldPrefetchHomeFeedYoutubeStreamByScroll. */
export function shouldPrefetchHomeFeedYoutubeStream(
  activeIndex: number,
  totalRows: number
): boolean {
  if (totalRows <= 0) return false;
  return activeIndex >= totalRows - HOME_FEED_YOUTUBE_PREFETCH_REMAINING;
}

/** Minimum delay after an append before another page may load. */
export const HOME_FEED_YOUTUBE_APPEND_COOLDOWN_MS = 2000;

export function peekHomeFeedStreamMetaSync(): HomeFeedPageCacheMeta | null {
  return metaMem;
}

export function effectiveStreamHasMore(
  meta: HomeFeedPageCacheMeta,
  loadedPageCount = getHomeFeedLoadedPageCount()
): boolean {
  if (meta.savedPageCount > loadedPageCount) return true;
  return meta.hasMore === true;
}

export function peekHomeFeedPagingFromPageCache(): HomeFeedPagingState {
  if (metaMem) {
    return {
      nextCursor:
        metaMem.nextCursor != null
          ? String(metaMem.nextCursor)
          : String(metaMem.pageSize * getHomeFeedLoadedPageCount()),
      hasMore: effectiveStreamHasMore(metaMem),
    };
  }
  return { nextCursor: "0", hasMore: true };
}

/** Flatten only pages loaded into memory this session (not full disk cache). */
export function getHomeFeedStreamRowsInMemory(): any[] {
  if (!loadedPagesMem.size) return [];
  const indices = Array.from(loadedPagesMem.keys()).sort((a, b) => a - b);
  const merged: any[] = [];
  for (const pageIndex of indices) {
    const rows = loadedPagesMem.get(pageIndex);
    if (rows?.length) merged.push(...rows);
  }
  return dedupeHomeFeedRowsByKey(merged);
}

export function getHomeFeedLoadedPageCount(): number {
  if (!loadedPagesMem.size) return 0;
  return Math.max(...loadedPagesMem.keys()) + 1;
}

export function getHomeFeedSavedPageCount(): number {
  return metaMem?.savedPageCount ?? 0;
}

function rowIds(rows: any[]) {
  return rows.map((row) => feedRenderKey(row) || String(row?.id || "").trim()).filter(Boolean);
}

async function readMetaFromDisk(userId: string): Promise<HomeFeedPageCacheMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(metaStorageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as HomeFeedPageCacheMeta;
  } catch {
    return null;
  }
}

async function writeMetaToDisk(meta: HomeFeedPageCacheMeta) {
  metaMem = meta;
  await AsyncStorage.setItem(metaStorageKey(meta.userId), JSON.stringify(meta));
}

function pageRowCountForMeta(meta: HomeFeedPageCacheMeta | null, pageIndex: number): number {
  return Math.max(0, meta?.pageRowCounts?.[pageIndex] ?? 0);
}

async function removePageRowKeys(
  userId: string,
  pageIndex: number,
  rowCount: number,
  prevRowCount = rowCount
) {
  const keys = new Set<string>();
  keys.add(pageStorageKey(userId, pageIndex));
  if (pageIndex === 0) {
    keys.add(page0BundleStorageKey(userId));
  }
  const maxRows = Math.max(rowCount, prevRowCount);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    keys.add(pageRowStorageKey(userId, pageIndex, rowIndex));
    keys.add(`${PAGE_PREFIX}${userId}:${pageIndex}:c${rowIndex}`);
  }
  if (keys.size) {
    await AsyncStorage.multiRemove([...keys]);
  }
}

async function pruneHomeFeedDiskCacheBeforePage0Save(userId: string) {
  await discardLegacyYoutubePageCacheKeys(userId);

  const allKeys = await AsyncStorage.getAllKeys();
  const prefixes = homeFeedPageCacheKeyPrefixes(userId);
  const keysToRemove = allKeys.filter((key) =>
    prefixes.some((prefix) => key === prefix || key.startsWith(prefix))
  );

  if (keysToRemove.length) {
    await AsyncStorage.multiRemove(keysToRemove);
    console.log("KRISTO_HOME_FEED_PAGE_CACHE_PRUNE", {
      userId,
      reason: "page0-rewrite",
      removedKeys: keysToRemove.length,
    });
  }

  loadedPagesMem.clear();
  metaMem = null;
}

type WritePageResult = {
  rowCount: number;
  bytes: number;
};

async function writePageToDisk(
  userId: string,
  pageIndex: number,
  rows: any[],
  prevMeta: HomeFeedPageCacheMeta | null
): Promise<WritePageResult> {
  const slimRows = slimHomeFeedPageCacheRows(rows);
  if (!slimRows.length) {
    return { rowCount: 0, bytes: 0 };
  }

  const sizeStats = summarizeHomeFeedPageCacheRowBytes(slimRows);
  console.log("KRISTO_HOME_FEED_PAGE_CACHE_SAVE_SIZE", {
    pageIndex,
    ...sizeStats,
    storage: "per-row",
  });

  const prevRowCount = pageRowCountForMeta(prevMeta, pageIndex);
  await removePageRowKeys(userId, pageIndex, slimRows.length, prevRowCount);

  try {
    const writes: [string, string][] = slimRows.map((row, rowIndex) => [
      pageRowStorageKey(userId, pageIndex, rowIndex),
      JSON.stringify(row),
    ]);
    if (pageIndex === 0) {
      writes.push([page0BundleStorageKey(userId), JSON.stringify(slimRows)]);
    }
    await AsyncStorage.multiSet(writes);
  } catch (err) {
    console.log("KRISTO_HOME_FEED_PAGE_CACHE_SAVE_ERROR", {
      pageIndex,
      ...sizeStats,
      message: String((err as Error)?.message || err),
    });
    throw err;
  }

  return { rowCount: slimRows.length, bytes: sizeStats.totalBytes };
}

async function readPage0RowsFromDisk(userId: string, meta: HomeFeedPageCacheMeta | null): Promise<any[] | null> {
  try {
    const bundleRaw = await AsyncStorage.getItem(page0BundleStorageKey(userId));
    if (bundleRaw) {
      try {
        const parsed = JSON.parse(bundleRaw);
        const rows = hydrateCachedRowsFromDisk(parsed);
        if (rows.length) return rows;
      } catch {
        // fall through to per-row read
      }
    }

    const rowCount = pageRowCountForMeta(meta, 0);
    if (rowCount > 0) {
      const keys = Array.from({ length: rowCount }, (_, rowIndex) =>
        pageRowStorageKey(userId, 0, rowIndex)
      );
      const pairs = await AsyncStorage.multiGet(keys);
      const merged: any[] = [];
      for (const [, raw] of pairs) {
        if (!raw) continue;
        try {
          merged.push(JSON.parse(raw));
        } catch {
          // skip corrupt row
        }
      }
      const rows = hydrateCachedRowsFromDisk(merged);
      return rows.length ? rows : null;
    }

    const raw = await AsyncStorage.getItem(pageStorageKey(userId, 0));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeFeedPagePayload;
    const rows = hydrateCachedRowsFromDisk(parsed?.rows);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

async function readPageFromDisk(userId: string, pageIndex: number): Promise<any[] | null> {
  try {
    if (pageIndex === 0) {
      const meta = metaMem?.userId === userId ? metaMem : await readMetaFromDisk(userId);
      return readPage0RowsFromDisk(userId, meta);
    }

    const meta = metaMem?.userId === userId ? metaMem : await readMetaFromDisk(userId);
    const rowCount = pageRowCountForMeta(meta, pageIndex);

    if (rowCount > 0) {
      const keys = Array.from({ length: rowCount }, (_, rowIndex) =>
        pageRowStorageKey(userId, pageIndex, rowIndex)
      );
      const pairs = await AsyncStorage.multiGet(keys);
      const merged: any[] = [];
      for (const [, raw] of pairs) {
        if (!raw) continue;
        try {
          merged.push(JSON.parse(raw));
        } catch {
          // skip corrupt row
        }
      }
      const rows = hydrateCachedRowsFromDisk(merged);
      return rows.length ? rows : null;
    }

    const raw = await AsyncStorage.getItem(pageStorageKey(userId, pageIndex));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeFeedPagePayload;
    const rows = hydrateCachedRowsFromDisk(parsed?.rows);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

/** Split legacy monolithic row cache — discard; force fresh media-only API collect. */
async function migrateLegacyMonolithicCacheIfNeeded(userId: string): Promise<HomeFeedPageCacheMeta | null> {
  const legacyRaw = await AsyncStorage.getItem(legacyRowsStorageKey(userId));
  if (!legacyRaw) return null;

  await AsyncStorage.removeItem(legacyRowsStorageKey(userId));
  console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD_LEGACY", {
    userId,
    from: "rows_v1",
    reason: "media-only-filter-v3",
  });
  return null;
}

let streamHydrateInflight: Promise<any[] | null> | null = null;
let lastStreamHydrateUserId = "";

async function hydrateHomeFeedStreamPagesFromDisk(
  uid: string,
  meta: HomeFeedPageCacheMeta
): Promise<any[] | null> {
  const pageCount = Math.max(0, meta.savedPageCount ?? 0);
  if (!pageCount) return null;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (loadedPagesMem.has(pageIndex)) continue;
    const page = await readPageFromDisk(uid, pageIndex);
    if (page?.length) {
      loadedPagesMem.set(pageIndex, page);
    }
  }

  const merged = getHomeFeedStreamRowsInMemory();
  if (!merged.length) return null;

  console.log("KRISTO_HOME_FEED_STREAM_HYDRATE", {
    count: merged.length,
    savedPageCount: pageCount,
    loadedPageCount: getHomeFeedLoadedPageCount(),
    hasMore: effectiveStreamHasMore(meta, getHomeFeedLoadedPageCount()),
    nextCursor: meta.nextCursor,
    ageMs: Math.max(0, Date.now() - (meta.savedAt || 0)),
  });

  return merged;
}

/** Hydrate every saved stream page for the current user (not just page 0). */
export async function hydrateHomeFeedStreamFromStorage(userId?: string): Promise<any[] | null> {
  const uid = String(userId || activeUserId()).trim() || "guest";

  if (metaMem?.userId === uid && loadedPagesMem.size > 0) {
    const merged = getHomeFeedStreamRowsInMemory();
    if (merged.length) return merged;
  }

  if (!userId && streamHydrateInflight && lastStreamHydrateUserId === uid) {
    return streamHydrateInflight;
  }

  lastStreamHydrateUserId = uid;
  streamHydrateInflight = (async () => {
    try {
      if (metaMem?.userId && metaMem.userId !== uid) {
        loadedPagesMem.clear();
        metaMem = null;
      }

      let meta = metaMem?.userId === uid ? metaMem : await readMetaFromDisk(uid);
      if (!meta) {
        meta = await migrateLegacyMonolithicCacheIfNeeded(uid);
      }

      const cacheValid = await ensureHomeFeedYoutubePageCacheValid(uid);
      if (!cacheValid) return null;

      meta = metaMem?.userId === uid ? metaMem : await readMetaFromDisk(uid);
      if (!meta) return null;

      if (needsYoutubePageCacheRebuild(meta)) {
        meta = await rebuildYoutubePageCacheLayout(uid, meta);
      }

      metaMem = meta;
      return hydrateHomeFeedStreamPagesFromDisk(uid, meta);
    } finally {
      streamHydrateInflight = null;
    }
  })();

  return streamHydrateInflight;
}

export async function hydrateHomeFeedPage0FromStorage(userId?: string): Promise<any[] | null> {
  const uid = String(userId || activeUserId()).trim() || "guest";

  if (loadedPagesMem.has(0) && metaMem?.userId === uid) {
    return loadedPagesMem.get(0) || null;
  }

  if (!userId && page0HydrateInflight && lastPage0HydrateUserId === uid) {
    return page0HydrateInflight;
  }

  lastPage0HydrateUserId = uid;
  page0HydrateInflight = (async () => {
    try {
      if (metaMem?.userId && metaMem.userId !== uid) {
        loadedPagesMem.clear();
        metaMem = null;
      }

      await discardLegacyYoutubePageCacheKeys(uid);

      const [[, metaRaw], [, bundleRaw]] = await AsyncStorage.multiGet([
        metaStorageKey(uid),
        page0BundleStorageKey(uid),
      ]);

      let meta: HomeFeedPageCacheMeta | null = null;
      if (metaRaw) {
        try {
          meta = JSON.parse(metaRaw) as HomeFeedPageCacheMeta;
        } catch {
          meta = null;
        }
      }
      if (!meta) {
        meta = await migrateLegacyMonolithicCacheIfNeeded(uid);
      }
      if (!meta) return null;

      if (needsYoutubePageCacheRebuild(meta)) {
        await clearHomeFeedPageCache(uid);
        console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD", {
          userId: uid,
          reason: "media-filter-or-layout-changed",
          previousFilterVersion: meta.mediaFilterVersion ?? null,
          previousFirstPageSize: meta.firstPageSize ?? null,
          previousSavedPageCount: meta.savedPageCount,
        });
        return null;
      }

      const page0RowCount = pageRowCountForMeta(meta, 0);
      if (
        page0RowCount > 0 &&
        page0RowCount < HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE &&
        effectiveStreamHasMore(meta, 1)
      ) {
        await clearHomeFeedPageCache(uid);
        console.log("KRISTO_HOME_FEED_PAGE_CACHE_DISCARD", {
          userId: uid,
          reason: "sparse-page0",
          page0Count: page0RowCount,
          target: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
        });
        return null;
      }

      metaMem = meta;

      if (bundleRaw) {
        try {
          const page0 = hydrateCachedRowsFromDisk(JSON.parse(bundleRaw));
          if (page0.length) {
            loadedPagesMem.set(0, page0);
            console.log("KRISTO_HOME_FEED_PAGE0_HYDRATE", {
              count: page0.length,
              savedPageCount: meta.savedPageCount,
              hasMore: effectiveStreamHasMore(meta, 1),
              nextCursor: meta.nextCursor,
              ageMs: Math.max(0, Date.now() - (meta.savedAt || 0)),
              source: "bundle",
            });
            return page0;
          }
        } catch {
          // fall through to per-row read
        }
      }

      const page0 = await readPage0RowsFromDisk(uid, meta);
      if (!page0?.length) return null;

      loadedPagesMem.set(0, page0);

      console.log("KRISTO_HOME_FEED_PAGE0_HYDRATE", {
        count: page0.length,
        savedPageCount: meta.savedPageCount,
        hasMore: effectiveStreamHasMore(meta, 1),
        nextCursor: meta.nextCursor,
        ageMs: Math.max(0, Date.now() - (meta.savedAt || 0)),
      });

      return page0;
    } finally {
      page0HydrateInflight = null;
    }
  })();

  return page0HydrateInflight;
}

export function peekHomeFeedPage0Sync(userId?: string): any[] | null {
  const uid = String(userId || activeUserId()).trim() || "guest";
  if (loadedPagesMem.has(0) && metaMem?.userId === uid) {
    return loadedPagesMem.get(0) || null;
  }
  return null;
}

export async function loadHomeFeedStreamPageFromDisk(
  pageIndex: number,
  userId?: string
): Promise<any[] | null> {
  if (loadedPagesMem.has(pageIndex)) {
    return loadedPagesMem.get(pageIndex) || null;
  }

  const rows = await peekHomeFeedStreamPageFromDisk(pageIndex, userId);
  if (!rows?.length) return null;

  loadedPagesMem.set(pageIndex, rows);
  console.log("KRISTO_HOME_FEED_PAGE_DISK_LOAD", { pageIndex, count: rows.length });
  return rows;
}

/** Read a disk page without loading it into the session memory map. */
export async function peekHomeFeedStreamPageFromDisk(
  pageIndex: number,
  userId?: string
): Promise<any[] | null> {
  const uid = String(userId || activeUserId()).trim() || "guest";

  if (!metaMem || metaMem.userId !== uid) {
    let meta = (await readMetaFromDisk(uid)) || (await migrateLegacyMonolithicCacheIfNeeded(uid));
    if (meta && needsYoutubePageCacheRebuild(meta)) {
      meta = await rebuildYoutubePageCacheLayout(uid, meta);
    }
    if (meta) metaMem = meta;
  }

  if (pageIndex >= (metaMem?.savedPageCount ?? 0)) return null;

  return readPageFromDisk(uid, pageIndex);
}

async function truncateHomeFeedStreamPagesAfter(pageIndex: number, userId: string) {
  const meta = metaMem?.userId === userId ? metaMem : await readMetaFromDisk(userId);
  if (!meta || meta.savedPageCount <= pageIndex + 1) return;

  const keysToRemove = new Set<string>();
  for (let i = pageIndex + 1; i < meta.savedPageCount; i += 1) {
    const rowCount = pageRowCountForMeta(meta, i);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      keysToRemove.add(pageRowStorageKey(userId, i, rowIndex));
    }
    keysToRemove.add(pageStorageKey(userId, i));
    loadedPagesMem.delete(i);
  }
  if (keysToRemove.size) {
    await AsyncStorage.multiRemove([...keysToRemove]);
    console.log("KRISTO_HOME_FEED_PAGE_CACHE_TRUNCATE", {
      userId,
      afterPageIndex: pageIndex,
      removedPages: keysToRemove.size,
      previousSavedPageCount: meta.savedPageCount,
    });
  }
}

export async function saveHomeFeedStreamPage(
  pageIndex: number,
  rows: any[],
  paging?: Partial<HomeFeedPagingState>,
  userId?: string
) {
  const uid = String(userId || activeUserId()).trim() || "guest";
  const normalized = normalizeCachedRows(rows);
  if (!normalized.length) return;

  const prev = metaMem?.userId === uid ? metaMem : await readMetaFromDisk(uid);

  if (pageIndex === 0) {
    await pruneHomeFeedDiskCacheBeforePage0Save(uid);
    await truncateHomeFeedStreamPagesAfter(0, uid);
  }

  const writeResult = await writePageToDisk(uid, pageIndex, normalized, prev);
  if (!writeResult.rowCount) return;

  loadedPagesMem.set(pageIndex, normalized);

  const snapshotRowIds = Array.from(
    new Set([...(prev?.snapshotRowIds || []), ...rowIds(normalized)])
  ).slice(-HOME_FEED_PAGE_CACHE_SNAPSHOT_ID_CAP);

  const savedPageCount = getHomeFeedLoadedPageCount();
  const resolvedHasMore =
    paging?.hasMore !== undefined
      ? paging.hasMore
      : prev
        ? effectiveStreamHasMore({ ...prev, savedPageCount }, savedPageCount)
        : true;
  const resolvedNextCursor =
    paging?.nextCursor !== undefined
      ? paging.nextCursor
      : resolvedHasMore
        ? prev?.nextCursor ?? null
        : null;

  const pageRowCounts = [...(prev?.pageRowCounts || [])];
  while (pageRowCounts.length <= pageIndex) {
    pageRowCounts.push(0);
  }
  pageRowCounts[pageIndex] = writeResult.rowCount;

  const meta: HomeFeedPageCacheMeta = {
    userId: uid,
    churchId: String(getSessionSync()?.churchId || prev?.churchId || "").trim(),
    pageSize: HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE,
    firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
    mediaFilterVersion: HOME_FEED_PAGE_CACHE_MEDIA_FILTER_VERSION,
    savedPageCount,
    pageRowCounts,
    nextCursor: resolvedNextCursor,
    hasMore: resolvedHasMore,
    savedAt: Date.now(),
    ...(snapshotRowIds.length ? { snapshotRowIds } : {}),
  };

  await writeMetaToDisk(meta);

  console.log("KRISTO_HOME_FEED_PAGE_CACHE_SAVE", {
    pageIndex,
    count: normalized.length,
    savedPageCount: meta.savedPageCount,
    rowCount: writeResult.rowCount,
    bytes: writeResult.bytes,
    nextCursor: meta.nextCursor,
    hasMore: meta.hasMore,
  });
}

export async function saveHomeFeedPageCachePaging(
  paging: Partial<HomeFeedPagingState>,
  userId?: string
) {
  const uid = String(userId || activeUserId()).trim() || "guest";
  const prev = metaMem?.userId === uid ? metaMem : await readMetaFromDisk(uid);
  if (!prev) return;

  const meta: HomeFeedPageCacheMeta = {
    ...prev,
    nextCursor:
      paging.nextCursor !== undefined ? paging.nextCursor : prev.nextCursor,
    hasMore: paging.hasMore !== undefined ? paging.hasMore : prev.hasMore,
    savedAt: Date.now(),
  };
  await writeMetaToDisk(meta);
}

export async function clearHomeFeedPageCache(userId?: string) {
  const uid = String(userId || activeUserId()).trim() || "guest";
  loadedPagesMem.clear();
  metaMem = null;
  clearHomeFeedYoutubeStreamSession();

  const meta = await readMetaFromDisk(uid);
  const pageCount = meta?.savedPageCount ?? 0;
  const keys = new Set<string>([metaStorageKey(uid), page0BundleStorageKey(uid)]);
  const allKeys = await AsyncStorage.getAllKeys();
  for (const key of allKeys) {
    if (
      key.startsWith(`${PAGE_PREFIX}${uid}:`) ||
      key.startsWith(`${ROW_PREFIX}${uid}:`) ||
      key === page0BundleStorageKey(uid)
    ) {
      keys.add(key);
    }
  }
  for (let i = 0; i < pageCount; i += 1) {
    keys.add(pageStorageKey(uid, i));
  }
  await AsyncStorage.multiRemove([...keys]);
}

let lastKickoffUserId = "";

export function kickoffHomeFeedPage0Hydrate() {
  const uid = activeUserId();
  if (uid === lastKickoffUserId && (loadedPagesMem.has(0) || page0HydrateInflight)) {
    return;
  }
  lastKickoffUserId = uid;
  void hydrateHomeFeedPage0FromStorage();
}
