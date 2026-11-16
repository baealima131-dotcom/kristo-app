import {
  homeFeedRowChurchId,
  isVideoPost,
  resolveFeedPostKind,
} from "@/src/components/homeFeed/homeFeedUtils";
import { youtubeVideoIdFromUrl } from "@/src/lib/externalVideoPlayerHtml";
import {
  isExternalVideoLinkItem,
  resolveHomeFeedVideoDisplayTypeHint,
} from "@/src/lib/homeFeedVideoDisplayType";
import { resolveVideoUri } from "@/src/lib/homeFeedVideoUri";
import { homeFeedUploadedVideoNeedsCover } from "@/src/lib/mediaVideoPoster";
import {
  homeFeedFreshnessPoints,
  homeFeedPersonalPoints,
  homeFeedQualityPoints,
  homeFeedTrendingPoints,
} from "@/src/lib/homeFeedMix";

const MAX_WATCH_HISTORY = 40;
const DEFAULT_LIMIT = 20;
/** Refill when Up Next falls below this many remaining candidates. */
export const WATCH_QUEUE_REFILL_THRESHOLD = 5;
/** Prefer keeping this many Up Next rows when backend data exists. */
export const WATCH_QUEUE_TARGET_DEPTH = 20;
/** Hard-exclude only the most recent N watched ids when recycling older posts. */
const WATCH_RECYCLE_RECENT_HARD_EXCLUDE = 8;
const WATCH_REFILL_MAX_PAGES = 4;

let watchSessionOrder: string[] = [];
let upNextGeneration = 0;
/** New for every Watch session, so Up Next order differs between sessions but not within one. */
let watchSessionSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0) as number;
/** Videos up to this age count as "new" when interleaving new and older videos. */
const WATCH_NEW_VIDEO_DAYS = 30;

function normalizePostId(item: any) {
  return String(item?.id || "").trim();
}

function postSortMs(row: any) {
  return Date.parse(String(row?.createdAt || row?.updatedAt || "")) || 0;
}

function resolveMediaCategory(item: any) {
  return String(
    item?.mediaCategory || item?.category || item?.contentCategory || item?.feedCategory || ""
  )
    .trim()
    .toLowerCase();
}

/** URL without query / hash (signed or cache-busting params differ between copies of a video). */
function stableVideoUrl(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.split(/[?#]/)[0].replace(/\/+$/, "");
  }
}

/**
 * The video a post plays, independent of the post id: the same YouTube video linked twice, or the
 * same uploaded file shared in two posts, has one key. Up Next never lists the same video twice,
 * nor the video that is playing now.
 */
export function homeFeedVideoContentKey(item: any): string {
  if (!item) return "";
  if (isExternalVideoLinkItem(item)) {
    const url = item?.videoUrl || item?.url;
    const youtubeId = youtubeVideoIdFromUrl(url);
    if (youtubeId) return `yt:${youtubeId}`;
    const stable = stableVideoUrl(url);
    return stable ? `link:${stable}` : "";
  }
  const stable = stableVideoUrl(resolveVideoUri(item));
  return stable ? `video:${stable}` : "";
}

/** Vertical (full-screen 9:16 and 4:5) vs landscape: the shape the viewer is watching in. */
function videoFormatFamily(item: any): "vertical" | "landscape" | "" {
  const type = resolveHomeFeedVideoDisplayTypeHint(item);
  if (!type) return "";
  return type === "youtube" ? "landscape" : "vertical";
}

function resolveVideoMediaBucket(item: any, viewerChurchId: string) {
  const churchId = homeFeedRowChurchId(item);
  if (churchId && viewerChurchId && churchId !== viewerChurchId) return "global_media";
  return "church_media";
}

function watchedPenalty(postId: string) {
  const index = watchSessionOrder.indexOf(postId);
  if (index < 0) return 0;
  if (index === 0) return 120;
  if (index === 1) return 90;
  if (index <= 4) return 65;
  if (index <= 10) return 40;
  return 20;
}

/**
 * Variety per Watch session and per watched video (generation): the same inputs give the same
 * order inside a session, a new session gives a different one.
 */
function generationJitter(postId: string, generationSeed: number) {
  let hash = (watchSessionSeed ^ Math.imul(generationSeed + 1, 9973)) >>> 0;
  for (let i = 0; i < postId.length; i += 1) {
    hash = (Math.imul(hash, 33) ^ postId.charCodeAt(i)) >>> 0;
  }
  return hash % 24;
}

export type WatchUpNextScoreBreakdown = {
  postId: string;
  total: number;
  sameChurch: number;
  sameCategory: number;
  samePostKind: number;
  sameMediaBucket: number;
  sameFormat: number;
  /** Viewer church / followed church / language / country (half weight; the current video's own
   * church match is in sameChurch). */
  personal: number;
  /** Engagement + views (bounded). */
  quality: number;
  /** Recent interactions per day (bounded). */
  trending: number;
  /** Small new-video bonus, 0 after 7 days. */
  freshness: number;
  watchedPenalty: number;
  jitter: number;
};

export function scoreWatchUpNextCandidate(params: {
  currentItem: any;
  candidate: any;
  viewerChurchId: string;
  generationSeed: number;
  newestMs?: number;
  oldestMs?: number;
}): WatchUpNextScoreBreakdown {
  const postId = normalizePostId(params.candidate);
  const current = params.currentItem;
  const candidate = params.candidate;

  const currentChurchId = homeFeedRowChurchId(current);
  const candidateChurchId = homeFeedRowChurchId(candidate);
  const sameChurch =
    currentChurchId && candidateChurchId && currentChurchId === candidateChurchId ? 48 : 0;

  const currentCategory = resolveMediaCategory(current);
  const candidateCategory = resolveMediaCategory(candidate);
  const sameCategory =
    currentCategory && candidateCategory && currentCategory === candidateCategory ? 28 : 0;

  const currentKind = resolveFeedPostKind(current) || "video";
  const candidateKind = resolveFeedPostKind(candidate) || "video";
  const samePostKind = currentKind === candidateKind ? 32 : 0;

  const viewerChurchId = String(params.viewerChurchId || "").trim();
  const currentBucket = resolveVideoMediaBucket(current, viewerChurchId);
  const candidateBucket = resolveVideoMediaBucket(candidate, viewerChurchId);
  const sameMediaBucket = currentBucket === candidateBucket ? 18 : 0;

  // Keep the viewer in the same shape of video (vertical after vertical, landscape after
  // landscape) when other signals are close; it never outweighs church / kind / category.
  const currentFormat = videoFormatFamily(current);
  const candidateFormat = videoFormatFamily(candidate);
  const sameFormat = currentFormat && candidateFormat && currentFormat === candidateFormat ? 16 : 0;

  // Bounded signals: a new or much-viewed video can rank high or low depending on everything
  // else; it is not put on top every time.
  const personal = Math.round(homeFeedPersonalPoints(candidate) * 0.5);
  const quality = Math.round(homeFeedQualityPoints(candidate));
  const trending = Math.round(homeFeedTrendingPoints(candidate));
  const freshness = Math.round(homeFeedFreshnessPoints(candidate));

  const penalty = watchedPenalty(postId);
  const jitter = generationJitter(postId, params.generationSeed);

  const total = Math.max(
    0,
    sameChurch +
      sameCategory +
      samePostKind +
      sameMediaBucket +
      sameFormat +
      personal +
      quality +
      trending +
      freshness +
      jitter -
      penalty
  );

  return {
    postId,
    total,
    sameChurch,
    sameCategory,
    samePostKind,
    sameMediaBucket,
    sameFormat,
    personal,
    quality,
    trending,
    freshness,
    watchedPenalty: penalty,
    jitter,
  };
}

/** Reset watched-history when the Watch experience fully closes. */
export function resetWatchUpNextSession() {
  watchSessionOrder = [];
  upNextGeneration = 0;
  watchSessionSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0) as number;
  console.log("KRISTO_WATCH_UP_NEXT_SESSION_RESET", { at: Date.now() });
}

/** Track recently watched videos for this Watch session — most recent first. */
export function recordWatchSessionVideo(postId: string): number {
  const id = normalizePostId({ id: postId });
  if (!id) return upNextGeneration;

  // Repeated tap on the already-current video must not bump generation or reorder history.
  if (watchSessionOrder[0] === id) {
    console.log("KRISTO_WATCH_UP_NEXT_SESSION", {
      postId: id,
      generation: upNextGeneration,
      watchedCount: watchSessionOrder.length,
      duplicateTap: true,
    });
    return upNextGeneration;
  }

  watchSessionOrder = [id, ...watchSessionOrder.filter((entry) => entry !== id)].slice(
    0,
    MAX_WATCH_HISTORY
  );
  upNextGeneration += 1;

  console.log("KRISTO_WATCH_UP_NEXT_SESSION", {
    postId: id,
    generation: upNextGeneration,
    watchedCount: watchSessionOrder.length,
    duplicateTap: false,
  });

  return upNextGeneration;
}

export function getWatchUpNextGeneration() {
  return upNextGeneration;
}

export function getWatchSessionPostIds() {
  return [...watchSessionOrder];
}

function buildWatchExcludeIds(currentId: string, extraExcludeIds?: string[]): Set<string> {
  const exclude = new Set<string>();
  if (currentId) exclude.add(currentId);
  const sessionIds = extraExcludeIds ?? watchSessionOrder;
  for (const id of sessionIds) {
    const normalized = String(id || "").trim();
    if (normalized) exclude.add(normalized);
  }
  return exclude;
}

/** Merge video rows from multiple feed snapshots without duplicate post ids. */
export function mergeWatchUpNextCandidateRows(...rowGroups: any[][]): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const group of rowGroups) {
    for (const row of group || []) {
      if (!isVideoPost(row)) continue;
      const id = normalizePostId(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
  }

  return merged;
}

function isNewWatchVideo(row: any) {
  const created = postSortMs(row);
  return created > 0 && Date.now() - created <= WATCH_NEW_VIDEO_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Mix new and older videos: never more than two in a row from the same age group when a video
 * of the other group is close behind (within the next 6). Keeps score order otherwise.
 */
function interleaveWatchAgeGroups(ranked: any[]): any[] {
  const rest = [...ranked];
  const out: any[] = [];
  // About one Watch session in three starts with the best older video when one is close behind
  // (top 6), so the first video is not always a new one. Fixed for the whole session.
  if (rest.length > 1 && watchSessionSeed % 3 === 0 && isNewWatchVideo(rest[0])) {
    const older = rest.slice(0, 6).findIndex((row) => !isNewWatchVideo(row));
    if (older > 0) out.push(rest.splice(older, 1)[0]);
  }
  while (rest.length) {
    let pickAt = 0;
    const n = out.length;
    if (n >= 2) {
      const lastNew = isNewWatchVideo(out[n - 1]);
      if (isNewWatchVideo(out[n - 2]) === lastNew && isNewWatchVideo(rest[0]) === lastNew) {
        const other = rest.slice(0, 6).findIndex((row) => isNewWatchVideo(row) !== lastNew);
        if (other > 0) pickAt = other;
      }
    }
    out.push(rest.splice(pickAt, 1)[0]);
  }
  return out;
}

/**
 * Prefer church diversity in the final Up Next window without discarding score order wholesale.
 * Walks the ranked list and skips a candidate when its church already fills the soft cap,
 * then fills remaining slots from leftovers.
 */
function diversifyWatchUpNextByChurch(ranked: any[], limit: number): any[] {
  if (ranked.length <= 1) return ranked.slice(0, limit);

  const softCap = Math.max(2, Math.ceil(limit / 3));
  const churchCounts = new Map<string, number>();
  const picked: any[] = [];
  const deferred: any[] = [];

  for (const row of ranked) {
    if (picked.length >= limit) break;
    const churchId = homeFeedRowChurchId(row) || "_unknown";
    const count = churchCounts.get(churchId) || 0;
    if (count >= softCap) {
      deferred.push(row);
      continue;
    }
    churchCounts.set(churchId, count + 1);
    picked.push(row);
  }

  for (const row of deferred) {
    if (picked.length >= limit) break;
    picked.push(row);
  }

  if (picked.length < limit) {
    const pickedIds = new Set(picked.map((row) => normalizePostId(row)));
    for (const row of ranked) {
      if (picked.length >= limit) break;
      const id = normalizePostId(row);
      if (!id || pickedIds.has(id)) continue;
      pickedIds.add(id);
      picked.push(row);
    }
  }

  return picked;
}

export function buildWatchUpNextVideos(params: {
  currentItem: any;
  candidates: any[];
  viewerChurchId?: string;
  limit?: number;
  generationSeed?: number;
  /** Defaults to this session's watched post ids (most recent first). */
  excludePostIds?: string[];
  /** When true, apply a light church diversity pass on the ranked window. */
  diversifyChurches?: boolean;
}): any[] {
  const currentId = normalizePostId(params.currentItem);
  const viewerChurchId = String(params.viewerChurchId || "").trim();
  const limit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
  const generationSeed = params.generationSeed ?? upNextGeneration;
  const excludeIds = buildWatchExcludeIds(currentId, params.excludePostIds);

  // The current video and excluded (watched / already listed) videos are also excluded by
  // content, so another post of the same video is not offered again.
  const excludeContentKeys = new Set<string>();
  const currentContentKey = homeFeedVideoContentKey(params.currentItem);
  if (currentContentKey) excludeContentKeys.add(currentContentKey);
  for (const row of params.candidates || []) {
    const id = normalizePostId(row);
    if (!id || id === currentId || !excludeIds.has(id)) continue;
    const key = homeFeedVideoContentKey(row);
    if (key) excludeContentKeys.add(key);
  }

  const pool = (params.candidates || []).filter((row) => {
    if (!isVideoPost(row)) return false;
    // Same rule as the Home Feed cards: an uploaded video without a real cover yet is not listed
    // or played in Watch. It stays in the candidate pool and is listed again once a cover exists
    // (next Up Next build). YouTube / link posts and videos with a cover are never affected.
    if (homeFeedUploadedVideoNeedsCover(row)) return false;
    const id = normalizePostId(row);
    if (!id || excludeIds.has(id)) return false;
    const key = homeFeedVideoContentKey(row);
    return !key || !excludeContentKeys.has(key);
  });

  if (!pool.length) return [];

  const scored = pool.map((candidate) => ({
    candidate,
    breakdown: scoreWatchUpNextCandidate({
      currentItem: params.currentItem,
      candidate,
      viewerChurchId,
      generationSeed,
    }),
  }));

  scored.sort((a, b) => {
    if (b.breakdown.total !== a.breakdown.total) {
      return b.breakdown.total - a.breakdown.total;
    }
    // Equal scores: keep a stable id order rather than always the newest first.
    const aId = normalizePostId(a.candidate);
    const bId = normalizePostId(b.candidate);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  // One row per video: keep the best-ranked post of each video.
  const seenContentKeys = new Set<string>();
  const rankedByScore = scored
    .map(({ candidate }) => candidate)
    .filter((candidate) => {
      const key = homeFeedVideoContentKey(candidate);
      if (!key) return true;
      if (seenContentKeys.has(key)) return false;
      seenContentKeys.add(key);
      return true;
    });
  const ranked = interleaveWatchAgeGroups(rankedByScore);
  const result =
    params.diversifyChurches === false
      ? ranked.slice(0, limit)
      : diversifyWatchUpNextByChurch(ranked, limit);

  console.log("KRISTO_WATCH_UP_NEXT_BUILT", {
    currentPostId: currentId,
    generation: generationSeed,
    excludedCount: excludeIds.size,
    candidateCount: pool.length,
    resultCount: result.length,
    top: scored.slice(0, 5).map(({ candidate, breakdown }) => ({
      postId: normalizePostId(candidate),
      score: breakdown.total,
      church: breakdown.sameChurch > 0,
      kind: breakdown.samePostKind > 0,
    })),
  });

  return result;
}

/** How many more videos Up Next adds each time the viewer reaches the end of the list. */
export const WATCH_UP_NEXT_PAGE_SIZE = 10;

/**
 * Next Up Next batch for a viewer who scrolled to the end of the list: real feed videos that are
 * not the current video, not already listed and not watched this session, ranked like the first
 * batch. Returns only the new rows (empty when the loaded videos are used up).
 */
export function nextWatchUpNextBatch(params: {
  currentItem: any;
  shownItems: any[];
  candidates: any[];
  viewerChurchId?: string;
  batchSize?: number;
  generationSeed?: number;
}): any[] {
  const exclude = [
    ...watchSessionOrder,
    ...(params.shownItems || []).map((row) => normalizePostId(row)).filter(Boolean),
  ];
  return buildWatchUpNextVideos({
    currentItem: params.currentItem,
    candidates: params.candidates,
    viewerChurchId: params.viewerChurchId,
    limit: Math.max(1, params.batchSize ?? WATCH_UP_NEXT_PAGE_SIZE),
    generationSeed: params.generationSeed,
    excludePostIds: exclude,
  });
}

export type WatchQueueRefillPage = {
  rows: any[];
  hasMore: boolean;
  source: string;
};

export type EnsureWatchQueueDepthResult = {
  items: any[];
  mergedCandidates: any[];
  queueSize: number;
  refillRequested: boolean;
  refillSource: string;
  fetchedCount: number;
  pagesFetched: number;
  dedupedCount: number;
  unseenCount: number;
  recycledCount: number;
  finalQueueCount: number;
  backendExhausted: boolean;
  generation: number;
  staleHasMoreProbeAttempted: boolean;
};

/**
 * Keep Up Next deep enough for continuous Watch navigation.
 * Fetches additional feed pages when the unseen pool is shallow, then recycles
 * older session-watched videos only after unseen + backend pools are exhausted.
 */
export async function ensureWatchQueueDepth(params: {
  currentItem: any;
  candidates: any[];
  viewerChurchId?: string;
  limit?: number;
  generationSeed?: number;
  threshold?: number;
  targetDepth?: number;
  hasMore?: boolean;
  /** Pages currently loaded into the home-feed stream (YouTube page cache). */
  loadedPageCount?: number;
  /**
   * Allow one stale-exhaustion probe this Watch session when paging reports
   * exhausted after a single in-memory page. Caller must pass false after use.
   */
  allowStaleExhaustionProbe?: boolean;
  /** Invoked at most once when the stale-exhaustion probe path is taken. */
  onStaleExhaustionProbe?: () => void;
  fetchNextPage?: () => Promise<WatchQueueRefillPage | null | undefined>;
}): Promise<EnsureWatchQueueDepthResult> {
  const currentId = normalizePostId(params.currentItem);
  const viewerChurchId = String(params.viewerChurchId || "").trim();
  const limit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
  const threshold = Math.max(1, params.threshold ?? WATCH_QUEUE_REFILL_THRESHOLD);
  const targetDepth = Math.max(threshold, params.targetDepth ?? WATCH_QUEUE_TARGET_DEPTH);
  const generationSeed = params.generationSeed ?? upNextGeneration;
  const loadedPageCount = Number.isFinite(params.loadedPageCount)
    ? Math.max(0, Number(params.loadedPageCount))
    : Number.POSITIVE_INFINITY;

  let mergedCandidates = mergeWatchUpNextCandidateRows(params.candidates || []);
  let refillRequested = false;
  let refillSource = "memory";
  let fetchedCount = 0;
  let dedupedCount = 0;
  let backendExhausted = params.hasMore === false;
  let pagesFetched = 0;
  let staleHasMoreProbeAttempted = false;

  const buildUnseen = (candidates: any[]) =>
    buildWatchUpNextVideos({
      currentItem: params.currentItem,
      candidates,
      viewerChurchId,
      limit: targetDepth,
      generationSeed,
    });

  let items = buildUnseen(mergedCandidates);
  let unseenCount = items.length;

  // Consistency guard: shallow queue + reported exhaustion after a single loaded
  // page is a potentially stale session-paging state. Clear exhaustion once so
  // refill can probe the backend before we fall back to recycle-only.
  if (
    backendExhausted &&
    items.length < targetDepth &&
    loadedPageCount <= 1 &&
    params.allowStaleExhaustionProbe === true &&
    typeof params.fetchNextPage === "function"
  ) {
    staleHasMoreProbeAttempted = true;
    backendExhausted = false;
    try {
      params.onStaleExhaustionProbe?.();
    } catch {}
    console.log("KRISTO_WATCH_QUEUE_STALE_HAS_MORE_PROBE", {
      currentPostId: currentId,
      generation: generationSeed,
      queueSize: items.length,
      targetDepth,
      loadedPageCount,
    });
  }

  console.log("KRISTO_WATCH_QUEUE_DEPTH", {
    currentPostId: currentId,
    generation: generationSeed,
    queueSize: items.length,
    threshold,
    targetDepth,
    loadedPageCount: Number.isFinite(loadedPageCount) ? loadedPageCount : null,
    staleHasMoreProbeAttempted,
    // After a stale probe clears local exhaustion, treat pagination as available.
    hasMore: !backendExhausted,
  });

  // After a stale probe clears exhaustion, refill up to targetDepth so we do not
  // wait until the threshold floor (and risk recycle) while pages may still exist.
  const refillFloor = staleHasMoreProbeAttempted ? targetDepth : threshold;

  while (
    items.length < refillFloor &&
    !backendExhausted &&
    typeof params.fetchNextPage === "function" &&
    pagesFetched < WATCH_REFILL_MAX_PAGES
  ) {
    refillRequested = true;
    console.log("KRISTO_WATCH_QUEUE_REFILL_REQUESTED", {
      currentPostId: currentId,
      generation: generationSeed,
      queueSize: items.length,
      threshold,
      refillFloor,
      pagesFetched,
      staleHasMoreProbeAttempted,
    });

    const page = await params.fetchNextPage();
    pagesFetched += 1;

    if (!page) {
      // Transient failure / caller skip — do not treat as backend exhausted.
      refillSource = refillSource === "memory" ? "fetch-skipped" : refillSource;
      break;
    }

    refillSource = String(page.source || "feed-next-page").trim() || "feed-next-page";
    if (refillSource === "inflight-skip" || refillSource === "stale-skip") {
      break;
    }
    if (refillSource === "no-more") {
      backendExhausted = true;
      break;
    }

    const incoming = Array.isArray(page.rows) ? page.rows : [];
    fetchedCount += incoming.length;

    const before = mergedCandidates.length;
    mergedCandidates = mergeWatchUpNextCandidateRows(mergedCandidates, incoming);
    const added = mergedCandidates.length - before;
    dedupedCount += Math.max(0, incoming.length - added);

    console.log("KRISTO_WATCH_QUEUE_REFILL_PAGE", {
      currentPostId: currentId,
      generation: generationSeed,
      refillSource,
      pagesFetched,
      fetchedCount: incoming.length,
      dedupedCount: Math.max(0, incoming.length - added),
      hasMore: page.hasMore === true,
      staleHasMoreProbeAttempted,
    });

    if (page.hasMore === true) {
      backendExhausted = false;
    } else {
      backendExhausted = true;
    }

    items = buildUnseen(mergedCandidates);
    unseenCount = items.length;

    if (added === 0 && backendExhausted) break;
    if (added === 0 && incoming.length === 0) break;
    if (items.length >= targetDepth) break;
  }

  let recycledCount = 0;
  // Recycle only after unseen pool is shallow AND backend pagination is exhausted.
  if (items.length < threshold && backendExhausted) {
    const recentHardExclude = watchSessionOrder.slice(0, WATCH_RECYCLE_RECENT_HARD_EXCLUDE);
    const recycleExclude = Array.from(
      new Set([currentId, ...recentHardExclude].filter(Boolean))
    );
    const recycled = buildWatchUpNextVideos({
      currentItem: params.currentItem,
      candidates: mergedCandidates,
      viewerChurchId,
      limit: targetDepth,
      generationSeed,
      excludePostIds: recycleExclude,
    });

    const sessionSet = new Set(watchSessionOrder);
    recycledCount = recycled.filter((row) => sessionSet.has(normalizePostId(row))).length;

    if (recycled.length > items.length) {
      items = recycled;
      refillSource =
        refillSource === "memory" || refillSource === "fetch-skipped"
          ? "recycle-session"
          : `${refillSource}+recycle`;
    }

    console.log("KRISTO_WATCH_QUEUE_RECYCLE", {
      currentPostId: currentId,
      generation: generationSeed,
      unseenCount,
      recycledCount,
      finalQueueCount: items.length,
      backendExhausted,
    });
  }

  // Trim to the UI limit after refill/recycle targeting.
  if (items.length > limit) {
    items = items.slice(0, limit);
  }

  const result: EnsureWatchQueueDepthResult = {
    items,
    mergedCandidates,
    queueSize: items.length,
    refillRequested,
    refillSource,
    fetchedCount,
    pagesFetched,
    dedupedCount,
    unseenCount,
    recycledCount,
    finalQueueCount: items.length,
    backendExhausted,
    generation: generationSeed,
    staleHasMoreProbeAttempted,
  };

  console.log("KRISTO_WATCH_QUEUE_ENSURED", {
    currentPostId: currentId,
    generation: result.generation,
    queueSize: result.queueSize,
    refillRequested: result.refillRequested,
    refillSource: result.refillSource,
    pagesFetched: result.pagesFetched,
    fetchedCount: result.fetchedCount,
    dedupedCount: result.dedupedCount,
    unseenCount: result.unseenCount,
    recycledCount: result.recycledCount,
    finalQueueCount: result.finalQueueCount,
    backendExhausted: result.backendExhausted,
    staleHasMoreProbeAttempted: result.staleHasMoreProbeAttempted,
  });

  return result;
}

/** Keep rows up to the current video fixed; reshuffle the tail for fresh recommendations. */
export function reshuffleHomeFeedRowsAfterWatchSelection(params: {
  rows: any[];
  currentItem: any;
  viewerChurchId?: string;
  generationSeed?: number;
}): any[] {
  const rows = params.rows || [];
  if (!rows.length) return rows;

  const currentId = normalizePostId(params.currentItem);
  if (!currentId) return rows;

  const currentIndex = rows.findIndex((row) => normalizePostId(row) === currentId);
  const head = currentIndex >= 0 ? rows.slice(0, currentIndex + 1) : rows.slice(0, 1);
  const tail = currentIndex >= 0 ? rows.slice(currentIndex + 1) : rows.slice(1);
  if (!tail.length) return rows;

  const reshuffledTail = buildWatchUpNextVideos({
    currentItem: params.currentItem,
    candidates: tail,
    viewerChurchId: params.viewerChurchId,
    limit: tail.length,
    generationSeed: params.generationSeed,
    diversifyChurches: false,
  });

  const pickedIds = new Set(reshuffledTail.map((row) => normalizePostId(row)));
  const remainder = tail.filter((row) => !pickedIds.has(normalizePostId(row)));

  return [...head, ...reshuffledTail, ...remainder];
}
