import { getSessionSync } from "@/src/lib/kristoSession";

/** Per app launch — rotates order on cold start. */
const HOME_FEED_SESSION_SEED = (Math.floor(Math.random() * 0xffffffff) >>> 0) as number;

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

export function sortRowsByPersonalSeed<T extends { id?: string; feedOriginId?: string }>(
  rows: T[],
  ctx: HomeFeedPersonalOrderContext,
  rowKeyFn: (row: T) => string,
  tieBreakMs: (row: T) => number
) {
  return [...rows].sort((a, b) => {
    const aRank = homeFeedPersonalRowRank(rowKeyFn(a), ctx);
    const bRank = homeFeedPersonalRowRank(rowKeyFn(b), ctx);
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

  console.log("KRISTO_HOME_FEED_VIDEO_BLOCK_ORDER", {
    total: arranged.length,
    videos: videos.length,
    posts: posts.length,
    videoBlockSize,
    firstKinds: arranged.slice(0, 12).map((row: any) => isHomeFeedVideoRow(row) ? "video" : "post"),
    firstIds: arranged.slice(0, 12).map((row: any) => rowKeyFn(row) || String(row?.id || "")),
  });

  return arranged;
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
