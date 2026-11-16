import { getSessionSync } from "@/src/lib/kristoSession";
import { resolveHomeFeedVideoDisplayTypeHint } from "@/src/lib/homeFeedVideoDisplayType";

/*
 * Home Feed / Watch mixing.
 *
 * The server pages the feed in a fixed order (newest first, then id) so cursors never repeat or
 * skip posts. The app decides the order the viewer sees:
 * 1. every post gets a score from bounded signals (no single signal can decide the order);
 * 2. posts are placed one by one, preferring the best score that does not repeat the same
 *    creator / church / country / language / video shape as the posts just before it;
 * 3. on load-more only posts that were fetched but not shown yet are placed, after the posts
 *    already on screen (which never move). A few are held back so the next page can be mixed
 *    with them; they are shown on the next load (or at the end of the feed), never dropped.
 */

/** Points per signal (bigger = earlier). Maxima are listed; see scoreHomeFeedRow. */
export const HOME_FEED_MIX_WEIGHTS = {
  /** Post from the viewer's own church (membership). */
  viewerChurch: 16,
  /** Post from a church the viewer follows. */
  followedChurch: 12,
  /** Church language is one of the viewer's languages / is not (only when both are saved). */
  languageMatch: 8,
  languageMismatch: -4,
  /** Viewer's country = church country or poster's country (only when saved). */
  countryMatch: 6,
  /** Same video shape (vertical / landscape) as most posts the viewer liked (max). */
  formatAffinity: 6,
  /** Likes + comments + shares, log scale (max). */
  engagement: 10,
  /** Views, log scale (max) — small on purpose. */
  views: 5,
  /** Recent posts gaining interactions quickly, last 14 days (max). */
  trending: 6,
  /** New post bonus, fades to 0 over 7 days (max) — small on purpose. */
  freshness: 6,
  /** Per-session variety so the order changes on refresh / new session (max). */
  sessionVariety: 14,
} as const;

/** Rows held back on load-more so the next page can be mixed with them. */
export const HOME_FEED_MIX_HOLDBACK = 6;
/** How many previous posts the variety rules look at. */
const MIX_RECENT_WINDOW = 6;
/** At most this share of placed posts from one creator while other creators are available. */
const MAX_CREATOR_SHARE = 1 / 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Per app launch; a refresh starts a new mix session (new variety order). */
const LAUNCH_SEED = (Math.floor(Math.random() * 0xffffffff) >>> 0) as number;
let mixRefreshGeneration = 0;

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Rows fetched from the server but not shown yet (cold-start lookahead and rows held back on
 * load-more), in the order they were fetched. They are placed by later load-mores and leave the
 * queue only when shown, so a delayed post is never lost even though the cursor moved past it.
 */
let pendingRows: any[] = [];

/** Adds fetched-but-not-shown rows to the queue (duplicates ignored). */
export function queueHomeFeedMixPendingRows<T>(rows: T[], rowKey: (row: T) => string) {
  if (!rows.length) return;
  const known = new Set(pendingRows.map((row) => rowKey(row)).filter(Boolean));
  for (const row of rows) {
    const key = rowKey(row);
    if (!key || known.has(key)) continue;
    known.add(key);
    pendingRows.push(row);
  }
}

export function peekHomeFeedMixPendingRows(): any[] {
  return pendingRows;
}

/** New variety order and an empty queue for the next feed (call on an explicit refresh). */
export function startNewHomeFeedMixSession() {
  mixRefreshGeneration += 1;
  pendingRows = [];
}

/** Stable for the whole session; changes per app launch, per refresh and per account/church. */
export function homeFeedMixSeedKey(): string {
  const session = getSessionSync() as any;
  const userId = String(session?.userId || "guest").trim() || "guest";
  const churchId = String(session?.churchId || "").trim() || "none";
  return `${userId}:${churchId}:${LAUNCH_SEED}:${mixRefreshGeneration}`;
}

function text(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function count(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** cap * log(1 + value) / log(1 + saturation), clamped to [0, cap]. */
function logPoints(value: number, cap: number, saturation: number) {
  if (value <= 0) return 0;
  return cap * Math.min(1, Math.log10(1 + value) / Math.log10(1 + saturation));
}

function createdMs(row: any) {
  const ms = Date.parse(String(row?.createdAt || row?.updatedAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function interactions(row: any) {
  return count(row?.likeCount) + 2 * count(row?.commentCount ?? row?.totalDiscussionCount) + count(row?.shareCount);
}

function viewCount(row: any) {
  return count(row?.viewCount ?? row?.views ?? row?.platformStats?.views);
}

/** Video shape family: vertical (full-screen / 4:5) or landscape; "" when unknown. */
export function homeFeedFormatFamily(row: any): "vertical" | "landscape" | "" {
  const type = resolveHomeFeedVideoDisplayTypeHint(row);
  if (!type) return "";
  return type === "youtube" ? "landscape" : "vertical";
}

/** Engagement + views (both log scale, bounded). */
export function homeFeedQualityPoints(row: any) {
  return (
    logPoints(interactions(row), HOME_FEED_MIX_WEIGHTS.engagement, 200) +
    logPoints(viewCount(row), HOME_FEED_MIX_WEIGHTS.views, 10_000)
  );
}

/** Small new-post bonus that fades to 0 over 7 days. */
export function homeFeedFreshnessPoints(row: any, nowMs = Date.now()) {
  const created = createdMs(row);
  if (!created) return 0;
  const ageDays = Math.max(0, (nowMs - created) / DAY_MS);
  return ageDays >= 7 ? 0 : HOME_FEED_MIX_WEIGHTS.freshness * (1 - ageDays / 7);
}

/** Interactions per day for posts up to 14 days old (bounded). */
export function homeFeedTrendingPoints(row: any, nowMs = Date.now()) {
  const created = createdMs(row);
  if (!created) return 0;
  const ageDays = (nowMs - created) / DAY_MS;
  if (ageDays > 14) return 0;
  const perDay = (interactions(row) + viewCount(row) / 50) / Math.max(1, ageDays);
  return logPoints(perDay, HOME_FEED_MIX_WEIGHTS.trending, 20);
}

/** Church membership / follow / language / country hints (server `feedSignals`). */
export function homeFeedPersonalPoints(row: any) {
  const signals = row?.feedSignals || {};
  const session = getSessionSync() as any;
  const viewerChurchId = String(session?.churchId || "").trim();
  const rowChurchId = String(row?.churchId || row?.ownerChurchId || "").trim();
  const isViewerChurch =
    signals.viewerChurch === true || Boolean(viewerChurchId && rowChurchId === viewerChurchId);

  let points = 0;
  if (isViewerChurch) points += HOME_FEED_MIX_WEIGHTS.viewerChurch;
  else if (signals.followedChurch === true) points += HOME_FEED_MIX_WEIGHTS.followedChurch;
  if (signals.languageMatch === true) points += HOME_FEED_MIX_WEIGHTS.languageMatch;
  else if (signals.languageMatch === false) points += HOME_FEED_MIX_WEIGHTS.languageMismatch;
  if (signals.countryMatch === true) points += HOME_FEED_MIX_WEIGHTS.countryMatch;
  return points;
}

/** Shape the viewer likes most among loaded posts they liked (needs 2+ likes, 60%+ share). */
function likedFormatPreference(rows: any[]): "vertical" | "landscape" | "" {
  let vertical = 0;
  let landscape = 0;
  for (const row of rows) {
    if (row?.likedByMe !== true && row?.liked !== true) continue;
    const family = homeFeedFormatFamily(row);
    if (family === "vertical") vertical += 1;
    else if (family === "landscape") landscape += 1;
  }
  const total = vertical + landscape;
  if (total < 2) return "";
  if (vertical / total >= 0.6) return "vertical";
  if (landscape / total >= 0.6) return "landscape";
  return "";
}

export type HomeFeedMixContext = {
  seedKey: string;
  nowMs: number;
  preferredFormat: "vertical" | "landscape" | "";
};

/** Time used for freshness / trending, fixed per mix session so repeated rankings agree. */
let sessionClock = { seedKey: "", nowMs: 0 };

export function buildHomeFeedMixContext(knownRows: any[]): HomeFeedMixContext {
  const seedKey = homeFeedMixSeedKey();
  if (sessionClock.seedKey !== seedKey) sessionClock = { seedKey, nowMs: Date.now() };
  return { seedKey, nowMs: sessionClock.nowMs, preferredFormat: likedFormatPreference(knownRows) };
}

export function scoreHomeFeedRow(row: any, rowKey: string, ctx: HomeFeedMixContext) {
  const personal = homeFeedPersonalPoints(row);
  const family = homeFeedFormatFamily(row);
  const formatAffinity =
    ctx.preferredFormat && family === ctx.preferredFormat ? HOME_FEED_MIX_WEIGHTS.formatAffinity : 0;
  const quality = homeFeedQualityPoints(row);
  const trending = homeFeedTrendingPoints(row, ctx.nowMs);
  const freshness = homeFeedFreshnessPoints(row, ctx.nowMs);
  const variety =
    (fnv1a(`${ctx.seedKey}:${rowKey}`) / 0xffffffff) * HOME_FEED_MIX_WEIGHTS.sessionVariety;
  return {
    total: personal + formatAffinity + quality + trending + freshness + variety,
    personal,
    formatAffinity,
    quality,
    trending,
    freshness,
    variety,
  };
}

/**
 * Grouping keys for the variety rules.
 * - creator: the real creator id — the platform creator (channel / author) for video link posts,
 *   the uploading user for uploads. A post without any creator id gets its own key, so unrelated
 *   posts are never treated as one creator.
 * - church: the church id; a post without a church is grouped only with its own creator.
 */
function mixKeys(row: any, rowKey = "") {
  const isLink = text(row?.source) === "system-admin-video-link";
  const creatorId = isLink
    ? text(row?.creatorId) || text(row?.createdBy || row?.authorUserId)
    : text(row?.createdBy || row?.authorUserId) || text(row?.creatorId);
  const creator = creatorId
    ? `${isLink ? "link" : "user"}:${creatorId}`
    : `post:${text(rowKey || row?.id)}`;
  const churchId = text(row?.churchId || row?.ownerChurchId);
  const church = churchId ? `church:${churchId}` : `nochurch:${creator}`;
  return {
    creator,
    church,
    country: text(row?.churchNormalizedCountry || row?.churchCountry),
    language: text(row?.churchPrimaryLanguage),
    format: homeFeedFormatFamily(row) || "unknown",
  };
}

type MixKeys = ReturnType<typeof mixKeys>;

function sameRun(recent: MixKeys[], field: keyof MixKeys, value: string, length: number) {
  if (!value || recent.length < length) return false;
  return recent.slice(-length).every((keys) => keys[field] === value);
}

/**
 * How many previous posts must separate two posts of a group that holds `share` of the remaining
 * candidates: a creator with 1/3 of what is left may appear every 3rd post, so its posts are
 * spread out instead of piling up at the end of the feed. Never more than 3; 0 when only that
 * group is left (then a run is allowed rather than hiding posts).
 */
function requiredGap(share: number, maxGap: number) {
  if (share >= 1) return 0;
  return Math.max(1, Math.min(maxGap, Math.floor(1 / Math.max(share, 1e-6)) - 1));
}

/** Penalty for placing `keys` right after `recent` (most recent last). 1000+ = avoid if possible.
 * `creatorShare` / `churchShare` = that group's share of the candidates not placed yet. */
function varietyPenalty(keys: MixKeys, recent: MixKeys[], creatorShare: number, churchShare: number) {
  let penalty = 0;
  const window = recent.slice(-MIX_RECENT_WINDOW);
  const creatorGap = requiredGap(creatorShare, 3);
  if (creatorGap > 0 && recent.slice(-creatorGap).some((k) => k.creator === keys.creator)) {
    penalty += 1000;
  } else if (window.some((k) => k.creator === keys.creator)) {
    penalty += Math.round(20 * (1 - creatorShare));
  }
  const churchGap = requiredGap(churchShare, 1);
  if (churchGap > 0 && recent.slice(-churchGap).some((k) => k.church === keys.church)) {
    penalty += 1000;
  }
  const churchInWindow = window.filter((k) => k.church === keys.church).length;
  if (churchInWindow >= 2) penalty += Math.round(25 * (1 - churchShare));
  else if (churchInWindow === 1 && recent.slice(-3).some((k) => k.church === keys.church)) {
    penalty += Math.round(12 * (1 - churchShare));
  }
  if (sameRun(recent, "country", keys.country, 3)) penalty += 6;
  if (sameRun(recent, "language", keys.language, 3)) penalty += 6;
  if (sameRun(recent, "format", keys.format, 3)) penalty += 5;
  return penalty;
}

/**
 * Picks `count` rows from `candidates` in display order. Each step takes the best score after
 * the variety penalty against the posts placed just before (starting from `recent`, the posts
 * already on screen). Ties keep the server order. Rows not picked are not returned.
 */
export function mixHomeFeedRows<T>(params: {
  candidates: T[];
  recent: T[];
  count: number;
  rowKey: (row: T) => string;
  ctx: HomeFeedMixContext;
}): T[] {
  const pool = params.candidates.map((row, index) => ({
    row,
    index,
    keys: mixKeys(row, params.rowKey(row)),
    score: scoreHomeFeedRow(row, params.rowKey(row), params.ctx).total,
  }));
  const recent: MixKeys[] = params.recent
    .slice(-MIX_RECENT_WINDOW)
    .map((row) => mixKeys(row, params.rowKey(row)));
  const picked: T[] = [];
  const target = Math.max(0, Math.min(params.count, pool.length));

  const creatorLeft = new Map<string, number>();
  const churchLeft = new Map<string, number>();
  for (const entry of pool) {
    creatorLeft.set(entry.keys.creator, (creatorLeft.get(entry.keys.creator) || 0) + 1);
    churchLeft.set(entry.keys.church, (churchLeft.get(entry.keys.church) || 0) + 1);
  }
  // Fair share: each creator gets places in proportion to its candidates, at most one post in
  // three. A creator behind its share is moved up, so a creator with many posts is spread over
  // the pages instead of being pushed (and piled up) to the end; its surplus waits in the queue.
  const poolSize = pool.length;
  const creatorTarget = new Map<string, number>();
  for (const [creator, n] of creatorLeft) {
    creatorTarget.set(creator, Math.min(MAX_CREATOR_SHARE, n / Math.max(1, poolSize)));
  }
  const creatorPlaced = new Map<string, number>();

  while (picked.length < target && pool.length) {
    let bestAt = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      const { creator, church } = pool[i].keys;
      const creatorShare = (creatorLeft.get(creator) || 0) / pool.length;
      const churchShare = (churchLeft.get(church) || 0) / pool.length;
      const deficit =
        (creatorTarget.get(creator) || 0) * (picked.length + 1) - (creatorPlaced.get(creator) || 0);
      const fairShareBoost = deficit >= 1 ? 25 * Math.min(2, deficit) : 0;
      const value =
        pool[i].score +
        fairShareBoost -
        varietyPenalty(pool[i].keys, recent, creatorShare, churchShare);
      if (value > bestValue || (value === bestValue && pool[i].index < pool[bestAt].index)) {
        bestValue = value;
        bestAt = i;
      }
    }
    const [chosen] = pool.splice(bestAt, 1);
    creatorLeft.set(chosen.keys.creator, (creatorLeft.get(chosen.keys.creator) || 1) - 1);
    creatorPlaced.set(chosen.keys.creator, (creatorPlaced.get(chosen.keys.creator) || 0) + 1);
    churchLeft.set(chosen.keys.church, (churchLeft.get(chosen.keys.church) || 1) - 1);
    picked.push(chosen.row);
    recent.push(chosen.keys);
    if (recent.length > MIX_RECENT_WINDOW) recent.shift();
  }

  return picked;
}

/**
 * Load-more: rows to append after `shown` (which never move). Candidates are the fetched rows
 * not shown yet, in server order, so a row held back earlier is never lost. Holds back
 * HOME_FEED_MIX_HOLDBACK rows for the next page unless `flush` (no more pages).
 */
export function selectHomeFeedAppendRows<T>(params: {
  shown: T[];
  fetched: T[];
  incomingCount: number;
  flush: boolean;
  rowKey: (row: T) => string;
  isEligible?: (row: T) => boolean;
}): T[] {
  const shownKeys = new Set(params.shown.map((row) => params.rowKey(row)).filter(Boolean));
  const seen = new Set<string>();
  const unseen: T[] = [];
  // Queued rows first (fetched earlier), then this fetch, in server order.
  for (const row of [...(pendingRows as T[]), ...params.fetched]) {
    const key = params.rowKey(row);
    if (!key || shownKeys.has(key) || seen.has(key)) continue;
    if (params.isEligible && !params.isEligible(row)) continue;
    seen.add(key);
    unseen.push(row);
  }
  if (!unseen.length) {
    pendingRows = [];
    return [];
  }

  const window = params.flush
    ? unseen
    : unseen.slice(0, Math.max(0, params.incomingCount) + HOME_FEED_MIX_HOLDBACK);
  const count = params.flush ? window.length : Math.max(0, window.length - HOME_FEED_MIX_HOLDBACK);

  const picked =
    count <= 0
      ? []
      : mixHomeFeedRows({
    candidates: window,
    recent: params.shown,
    count,
    rowKey: params.rowKey,
    ctx: buildHomeFeedMixContext([...params.shown, ...unseen]),
  });

  // Everything fetched and not shown now (held back, or outside this window) waits in the queue.
  const pickedKeys = new Set(picked.map((row) => params.rowKey(row)));
  pendingRows = unseen.filter((row) => !pickedKeys.has(params.rowKey(row)));

  console.log("KRISTO_HOME_FEED_MIX_APPEND", {
    shown: params.shown.length,
    unseen: unseen.length,
    window: window.length,
    appended: picked.length,
    queued: pendingRows.length,
    flush: params.flush,
  });
  return picked;
}
