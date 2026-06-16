import { getSessionSync } from "@/src/lib/kristoSession";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";

/** Per app launch — rotates order on cold start. */
const HOME_FEED_SESSION_SEED = (Math.floor(Math.random() * 0xffffffff) >>> 0) as number;

/** ~7% personal-rank bias for viewer church — subtle, not church-only ordering. */
const HOME_FEED_OWN_CHURCH_RANK_BIAS = 0.93;

/** Non-video posts older than this (without recent update) sink in tie-break. */
const HOME_FEED_STALE_POST_DAYS = 30;

/** Cap freshness penalty so very old posts still appear, just lower. */
const HOME_FEED_MAX_FRESHNESS_PENALTY_MS = 14 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

let activePersonalSeedKey = "";
const personalRankByRowKey = new Map<string, number>();
let lastLoggedPersonalSeedKey = "";

export type HomeFeedPersonalOrderContext = {
  userId: string;
  churchId: string;
  hourBucket: string;
  sessionSeed: number;
  seedKey: string;
  seed: number;
};

export function getHomeFeedSessionSeed() {
  return HOME_FEED_SESSION_SEED;
}

export function getHomeFeedHourBucket(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day}-${h}`;
}

function fnv1aHash(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function resolveHomeFeedPersonalOrderContext(nowMs = Date.now()): HomeFeedPersonalOrderContext {
  const session = getSessionSync() as any;
  const userId = String(session?.userId || "guest").trim() || "guest";
  const churchId = String(session?.churchId || "").trim();
  const hourBucket = getHomeFeedHourBucket(nowMs);
  const sessionSeed = getHomeFeedSessionSeed();
  const seedKey = `${userId}:${churchId || "none"}:${hourBucket}:${sessionSeed}`;
  const seed = fnv1aHash(seedKey);

  return { userId, churchId, hourBucket, sessionSeed, seedKey, seed };
}

export function resetHomeFeedPersonalOrderIfNeeded(seedKey: string) {
  if (seedKey === activePersonalSeedKey) return;
  activePersonalSeedKey = seedKey;
  personalRankByRowKey.clear();
}

export function homeFeedPersonalRowRank(
  rowKey: string,
  ctx: HomeFeedPersonalOrderContext
): number {
  const key = String(rowKey || "").trim();
  if (!key) return Number.MAX_SAFE_INTEGER;

  const cacheKey = `${ctx.seedKey}:${key}`;
  const cached = personalRankByRowKey.get(cacheKey);
  if (cached !== undefined) return cached;

  const rank = fnv1aHash(`${ctx.seed}:${key}`);
  personalRankByRowKey.set(cacheKey, rank);
  return rank;
}

function homeFeedRowChurchId(row: any) {
  return String(row?.churchId || row?.ownerChurchId || "").trim();
}

function homeFeedRowIsOwnChurch(row: any, viewerChurchId: string) {
  const viewerCid = String(viewerChurchId || "").trim();
  if (!viewerCid) return false;
  return homeFeedRowChurchId(row) === viewerCid;
}

/** Slight rank boost for viewer church rows — global posts still interleave. */
export function homeFeedPersonalRankWithChurchBoost(
  rowKey: string,
  ctx: HomeFeedPersonalOrderContext,
  row: any
): number {
  const rank = homeFeedPersonalRowRank(rowKey, ctx);
  if (!homeFeedRowIsOwnChurch(row, ctx.churchId)) return rank;
  return Math.floor(rank * HOME_FEED_OWN_CHURCH_RANK_BIAS);
}

/**
 * Tie-break timestamp for V1 ranking.
 * Videos and recently updated posts keep natural recency; stale non-video posts sink.
 */
export function homeFeedFreshnessSortMs(
  row: any,
  nowMs = Date.now(),
  isVideo = false
): number {
  const created = Date.parse(String(row?.createdAt || "")) || 0;
  const updated = Date.parse(String(row?.updatedAt || "")) || 0;
  const base = Math.max(created, updated);
  if (!base) return 0;

  if (isVideo) return base;

  const recentlyUpdated =
    updated > 0 && nowMs - updated <= HOME_FEED_STALE_POST_DAYS * DAY_MS;
  if (recentlyUpdated) return Math.max(base, updated);

  const ageMs = Math.max(0, nowMs - base);
  const staleMs = ageMs - HOME_FEED_STALE_POST_DAYS * DAY_MS;
  if (staleMs <= 0) return base;

  return base - Math.min(staleMs, HOME_FEED_MAX_FRESHNESS_PENALTY_MS);
}

export function sortRowsByPersonalSeed<
  T extends { id?: string; feedOriginId?: string; churchId?: string; ownerChurchId?: string },
>(
  rows: T[],
  ctx: HomeFeedPersonalOrderContext,
  rowKeyFn: (row: T) => string,
  tieBreakMs: (row: T) => number
) {
  return [...rows].sort((a, b) => {
    const aRank = homeFeedPersonalRankWithChurchBoost(rowKeyFn(a), ctx, a);
    const bRank = homeFeedPersonalRankWithChurchBoost(rowKeyFn(b), ctx, b);
    if (aRank !== bRank) return aRank - bRank;
    return tieBreakMs(b) - tieBreakMs(a);
  });
}


function isHomeFeedVideoRow(row: any): boolean {
  return row?.mediaType === "video" || row?.type === "video" || Boolean(row?.videoUrl || row?.mediaUri);
}

/**
 * V1 Home Feed UX: avoid boring video/post/video/post alternation.
 * Put a strong video block first so 8–10 videos can be preloaded and played quickly.
 */
export function arrangeHomeFeedVideoBlockFirst<T extends { id?: string; feedOriginId?: string }>(
  rows: T[],
  ctx: HomeFeedPersonalOrderContext,
  rowKeyFn: (row: T) => string,
  tieBreakMs: (row: T) => number,
  videoBlockSize = 10,
  postBreakSize = 4
): T[] {
  const personallySorted = sortRowsByPersonalSeed(rows, ctx, rowKeyFn, tieBreakMs);
  const videos = personallySorted.filter((row) => isHomeFeedVideoRow(row));
  const posts = personallySorted.filter((row) => !isHomeFeedVideoRow(row));

  const arranged = [
    ...videos.slice(0, videoBlockSize),
    ...posts.slice(0, postBreakSize),
    ...videos.slice(videoBlockSize),
    ...posts.slice(postBreakSize),
  ];

  logHomeFeedRankV1(arranged, ctx, rowKeyFn, tieBreakMs);

  console.log("KRISTO_HOME_FEED_VIDEO_BLOCK_ORDER", {
    total: arranged.length,
    videos: videos.length,
    posts: posts.length,
    videoBlockSize,
    firstKinds: arranged.slice(0, 12).map((row: any) => (isHomeFeedVideoRow(row) ? "video" : "post")),
    firstIds: arranged.slice(0, 12).map((row: any) => rowKeyFn(row) || String(row?.id || "")),
  });

  return arranged;
}

export function logHomeFeedRankV1(
  rows: any[],
  ctx: HomeFeedPersonalOrderContext,
  rowKeyFn: (row: any) => string,
  tieBreakMs: (row: any) => number
) {
  if (!isKristoVerboseFeedDebug()) return;
  const sample = rows.slice(0, 12);
  const viewerCid = String(ctx.churchId || "").trim();
  let stalePenalized = 0;

  for (const row of rows) {
    if (isHomeFeedVideoRow(row)) continue;
    const created = Date.parse(String(row?.createdAt || "")) || 0;
    const updated = Date.parse(String(row?.updatedAt || "")) || 0;
    const base = Math.max(created, updated);
    if (!base) continue;
    const recentlyUpdated =
      updated > 0 && Date.now() - updated <= HOME_FEED_STALE_POST_DAYS * DAY_MS;
    if (recentlyUpdated) continue;
    if (Date.now() - base > HOME_FEED_STALE_POST_DAYS * DAY_MS) stalePenalized += 1;
  }

  console.log("KRISTO_HOME_FEED_RANK_V1", {
    viewerChurchId: viewerCid || null,
    total: rows.length,
    ownChurchInFirst12: sample.filter((row) => homeFeedRowIsOwnChurch(row, viewerCid)).length,
    videosInFirst12: sample.filter((row) => isHomeFeedVideoRow(row)).length,
    stalePenalizedCount: stalePenalized,
    churchBoostBias: HOME_FEED_OWN_CHURCH_RANK_BIAS,
    stalePostDays: HOME_FEED_STALE_POST_DAYS,
    firstIds: sample.map((row) => rowKeyFn(row) || String(row?.id || "")),
    firstTieBreakMs: sample.map((row) => tieBreakMs(row)),
  });
}

export function logHomeFeedPersonalSeed(ctx: HomeFeedPersonalOrderContext) {
  if (ctx.seedKey === lastLoggedPersonalSeedKey) return;
  lastLoggedPersonalSeedKey = ctx.seedKey;
  console.log("KRISTO_HOME_FEED_PERSONAL_SEED", {
    userId: ctx.userId,
    churchId: ctx.churchId || null,
    hourBucket: ctx.hourBucket,
    sessionSeed: ctx.sessionSeed,
    seed: ctx.seed,
  });
}

export function logHomeFeedPersonalOrder(
  display: any[],
  ctx: HomeFeedPersonalOrderContext,
  rowKeyFn: (row: any) => string
) {
  console.log("KRISTO_HOME_FEED_PERSONAL_ORDER", {
    seedKey: ctx.seedKey,
    total: display.length,
    orderedIds: display.slice(0, 12).map((row) => rowKeyFn(row) || String(row?.id || "")),
  });
}

export function logHomeFeedFirstRows(display: any[], rowKeyFn: (row: any) => string) {
  console.log("KRISTO_HOME_FEED_FIRST_ROWS", {
    count: Math.min(5, display.length),
    rowIds: display.slice(0, 5).map((row) => rowKeyFn(row) || String(row?.id || "")),
    kinds: display.slice(0, 5).map((row) => {
      if (row?.homeFeedSlotExpanded) return "schedule-slot";
      if (row?.isLiveNow || row?.kind === "live") return "live";
      if (row?.scheduleType) return "schedule";
      return row?.mediaType === "video" || row?.type === "video" ? "video" : "post";
    }),
  });
}
