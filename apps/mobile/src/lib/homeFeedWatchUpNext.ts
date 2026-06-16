import {
  homeFeedRowChurchId,
  isVideoPost,
  resolveFeedPostKind,
} from "@/src/components/homeFeed/homeFeedUtils";

const MAX_WATCH_HISTORY = 40;
const DEFAULT_LIMIT = 20;

let watchSessionOrder: string[] = [];
let upNextGeneration = 0;

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

/** Small per-generation jitter so Up Next order refreshes without feeling random. */
function generationJitter(postId: string, generationSeed: number) {
  let hash = generationSeed * 9973;
  for (let i = 0; i < postId.length; i += 1) {
    hash = (hash * 33) ^ postId.charCodeAt(i);
  }
  return (hash >>> 0) % 24;
}

function recencyScoreMs(createdMs: number, newestMs: number, oldestMs: number) {
  if (!createdMs || newestMs <= oldestMs) return 0;
  const ratio = (createdMs - oldestMs) / (newestMs - oldestMs);
  return Math.round(Math.max(0, Math.min(1, ratio)) * 22);
}

export type WatchUpNextScoreBreakdown = {
  postId: string;
  total: number;
  sameChurch: number;
  sameCategory: number;
  samePostKind: number;
  sameMediaBucket: number;
  recency: number;
  watchedPenalty: number;
  jitter: number;
};

export function scoreWatchUpNextCandidate(params: {
  currentItem: any;
  candidate: any;
  viewerChurchId: string;
  generationSeed: number;
  newestMs: number;
  oldestMs: number;
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

  const recency = recencyScoreMs(
    postSortMs(candidate),
    params.newestMs,
    params.oldestMs
  );

  const penalty = watchedPenalty(postId);
  const jitter = generationJitter(postId, params.generationSeed);

  const total = Math.max(
    0,
    sameChurch + sameCategory + samePostKind + sameMediaBucket + recency + jitter - penalty
  );

  return {
    postId,
    total,
    sameChurch,
    sameCategory,
    samePostKind,
    sameMediaBucket,
    recency,
    watchedPenalty: penalty,
    jitter,
  };
}

/** Track recently watched videos for this app session — most recent first. */
export function recordWatchSessionVideo(postId: string): number {
  const id = normalizePostId({ id: postId });
  if (!id) return upNextGeneration;

  watchSessionOrder = [id, ...watchSessionOrder.filter((entry) => entry !== id)].slice(
    0,
    MAX_WATCH_HISTORY
  );
  upNextGeneration += 1;

  console.log("KRISTO_WATCH_UP_NEXT_SESSION", {
    postId: id,
    generation: upNextGeneration,
    watchedCount: watchSessionOrder.length,
  });

  return upNextGeneration;
}

export function getWatchUpNextGeneration() {
  return upNextGeneration;
}

export function getWatchSessionPostIds() {
  return [...watchSessionOrder];
}

export function buildWatchUpNextVideos(params: {
  currentItem: any;
  candidates: any[];
  viewerChurchId?: string;
  limit?: number;
  generationSeed?: number;
}): any[] {
  const currentId = normalizePostId(params.currentItem);
  const viewerChurchId = String(params.viewerChurchId || "").trim();
  const limit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
  const generationSeed = params.generationSeed ?? upNextGeneration;

  const pool = (params.candidates || []).filter((row) => {
    if (!isVideoPost(row)) return false;
    const id = normalizePostId(row);
    return id && id !== currentId;
  });

  if (!pool.length) return [];

  const times = pool.map(postSortMs).filter((ms) => ms > 0);
  const newestMs = times.length ? Math.max(...times) : Date.now();
  const oldestMs = times.length ? Math.min(...times) : newestMs - 1;

  const scored = pool.map((candidate) => ({
    candidate,
    breakdown: scoreWatchUpNextCandidate({
      currentItem: params.currentItem,
      candidate,
      viewerChurchId,
      generationSeed,
      newestMs,
      oldestMs,
    }),
  }));

  scored.sort((a, b) => {
    if (b.breakdown.total !== a.breakdown.total) {
      return b.breakdown.total - a.breakdown.total;
    }
    return postSortMs(b.candidate) - postSortMs(a.candidate);
  });

  const result = scored.slice(0, limit).map(({ candidate }) => candidate);

  console.log("KRISTO_WATCH_UP_NEXT_BUILT", {
    currentPostId: currentId,
    generation: generationSeed,
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
  });

  const pickedIds = new Set(reshuffledTail.map((row) => normalizePostId(row)));
  const remainder = tail.filter((row) => !pickedIds.has(normalizePostId(row)));

  return [...head, ...reshuffledTail, ...remainder];
}
