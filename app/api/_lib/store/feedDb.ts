import { neon, neonConfig } from "@neondatabase/serverless";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import { isMediaScheduleFeedItem, findActiveMediaScheduleForChurch, findMediaScheduleFeedForChurch } from "@/lib/mediaScheduleLock";

neonConfig.fetchConnectionCache = true;

export type FeedType = "post" | "announcement" | "video";

export type ChurchFeedItem = {
  id: string;
  churchId: string;
  type: FeedType;
  title?: string;
  text?: string;
  videoUrl?: string;
  mediaUri?: string;
  source?: string;
  scheduleType?: string;
  scheduleSlots?: any[];
  visibility?: string;
  audience?: any;
  mediaName?: string;
  churchName?: string;
  churchLabel?: string;
  actorLabel?: string;
  actorAvatarUri?: string;
  churchAvatarUri?: string;
  avatarUri?: string;
  mediaOwnerPastorUserId?: string;
  actualChurchPastorUserId?: string;
  churchPastorUserId?: string;
  scheduleCreatedByUserId?: string;
  sourceScheduleId?: string;
  publishedAt?: string;
  mediaHostIds?: string;
  isGlobalMediaSlot?: boolean;
  ownershipType?: "church" | "media" | "member";
  ownerChurchId?: string;
  ownerMediaId?: string;
  createdAt: string;
  createdBy: string;
  [key: string]: unknown;
};

type FeedRow = {
  id: string;
  church_id: string;
  type: string;
  source: string | null;
  schedule_type: string | null;
  created_by: string;
  visibility: string | null;
  payload: ChurchFeedItem;
  created_at: string;
  updated_at: string | null;
};

const LOCAL_FEED_FILE = "church-feed.json";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

function usePostgres() {
  return hasDurableStore();
}

function nowIso() {
  return new Date().toISOString();
}

export type FeedStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveFeedStoreMode(): FeedStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function ensureFeedStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Feed database not configured");
  }
  if (usePostgres()) {
    await ensureFeedSchema();
  }
}

export async function ensureFeedSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_feed (
          id TEXT PRIMARY KEY,
          church_id TEXT NOT NULL,
          type TEXT NOT NULL,
          source TEXT,
          schedule_type TEXT,
          created_by TEXT NOT NULL,
          visibility TEXT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_church_idx
        ON kristo_church_feed (church_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_source_idx
        ON kristo_church_feed (source, schedule_type)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_created_idx
        ON kristo_church_feed (created_at DESC)
      `;
    })();
  }
  await schemaReady;
}

/** Image fields that must survive feedDb read/write normalization. */
const FEED_IMAGE_FIELD_KEYS = [
  "mediaUri",
  "imageUrl",
  "photoUrl",
  "imageUri",
  "mediaType",
  "images",
  "attachments",
  "mediaUrls",
] as const;

/** Video poster fields that must survive feedDb read/write normalization. */
const FEED_VIDEO_POSTER_FIELD_KEYS = [
  "posterUri",
  "videoPosterUri",
  "thumbnailUri",
  "thumbnailUrl",
  "brandedPoster",
] as const;

function extractFeedImageFields(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FEED_IMAGE_FIELD_KEYS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !String(value).trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function extractFeedVideoPosterFields(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FEED_VIDEO_POSTER_FIELD_KEYS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !String(value).trim()) continue;
    out[key] = value;
  }
  return out;
}

function rowToFeedItem(row: FeedRow): ChurchFeedItem {
  const payload =
    row.payload && typeof row.payload === "object" ? (row.payload as ChurchFeedItem) : ({} as ChurchFeedItem);
  const imageFields = extractFeedImageFields(payload as Record<string, unknown>);
  const posterFields = extractFeedVideoPosterFields(payload as Record<string, unknown>);

  return {
    ...payload,
    ...imageFields,
    ...posterFields,
    id: row.id,
    churchId: row.church_id || payload.churchId,
    type: (row.type || payload.type) as FeedType,
    source: row.source || payload.source,
    scheduleType: row.schedule_type || payload.scheduleType,
    createdBy: row.created_by || payload.createdBy,
    visibility: row.visibility || payload.visibility,
    createdAt: payload.createdAt || row.created_at,
  };
}

function feedItemToPayload(item: ChurchFeedItem): ChurchFeedItem {
  const imageFields = extractFeedImageFields(item as Record<string, unknown>);
  const posterFields = extractFeedVideoPosterFields(item as Record<string, unknown>);
  return { ...item, ...imageFields, ...posterFields };
}

export function countScheduleFeedItems(items: ChurchFeedItem[]): number {
  return items.filter((item) => {
    if (!isMediaScheduleFeedItem(item)) return false;
    const slots = Array.isArray(item.scheduleSlots) ? item.scheduleSlots : [];
    return slots.length > 0;
  }).length;
}

async function readLocalFeedItems(): Promise<ChurchFeedItem[]> {
  const rows = await readJsonFile<ChurchFeedItem[]>(LOCAL_FEED_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalFeedItems(items: ChurchFeedItem[]) {
  await writeJsonFile(LOCAL_FEED_FILE, items);
}

export async function listFeedItems(): Promise<ChurchFeedItem[]> {
  await ensureFeedStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
      FROM kristo_church_feed
      ORDER BY created_at DESC
    `;
    return (rows as FeedRow[]).map(rowToFeedItem);
  }

  return readLocalFeedItems();
}

export async function listFeedItemsForChurch(churchId: string): Promise<ChurchFeedItem[]> {
  const cid = String(churchId || "").trim();
  await ensureFeedStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows = cid
      ? await sql`
          SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
          FROM kristo_church_feed
          WHERE church_id = ${cid}
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
          FROM kristo_church_feed
          ORDER BY created_at DESC
        `;

    const items = (rows as FeedRow[]).map(rowToFeedItem);
    const scheduleCount = countScheduleFeedItems(items);
    console.log("[FeedDb] list churchId count scheduleCount", {
      churchId: cid || "*",
      count: items.length,
      scheduleCount,
    });
    return items;
  }

  const all = await readLocalFeedItems();
  const items = cid ? all.filter((x) => String(x.churchId || "") === cid) : all;
  const scheduleCount = countScheduleFeedItems(items);
  console.log("[FeedDb] list churchId count scheduleCount", {
    churchId: cid || "*",
    count: items.length,
    scheduleCount,
  });
  return items;
}

const SCHEDULE_FEED_ID_PAYLOAD_KEYS = [
  "sourceScheduleId",
  "liveId",
  "liveScheduleFeedId",
  "scheduleFeedId",
  "parentScheduleId",
  "postId",
  "feedId",
] as const;

export function normalizeScheduleFeedIdBase(input: unknown): string {
  const id = String(input || "")
    .replace(/__fy_\d+$/g, "")
    .trim();
  if (!id) return "";
  return id.split("__slot_")[0];
}

export function collectFeedItemScheduleFeedIds(item: ChurchFeedItem): string[] {
  const ids = new Set<string>();
  const primaryId = String(item?.id || "").trim();
  if (primaryId) {
    ids.add(primaryId);
    const base = normalizeScheduleFeedIdBase(primaryId);
    if (base) ids.add(base);
  }
  for (const key of SCHEDULE_FEED_ID_PAYLOAD_KEYS) {
    const value = String((item as any)[key] || "").trim();
    if (!value) continue;
    ids.add(value);
    const base = normalizeScheduleFeedIdBase(value);
    if (base) ids.add(base);
  }
  return Array.from(ids);
}

export function feedItemMatchesScheduleFeedId(item: ChurchFeedItem, feedId: string): boolean {
  const needle = String(feedId || "").trim();
  if (!needle) return false;
  const needleBase = normalizeScheduleFeedIdBase(needle);
  const haystack = collectFeedItemScheduleFeedIds(item);
  return haystack.some(
    (candidate) =>
      candidate === needle || (needleBase && normalizeScheduleFeedIdBase(candidate) === needleBase)
  );
}

export function feedItemMatchesTargetChurch(item: ChurchFeedItem, targetChurchId: string): boolean {
  const cid = String(targetChurchId || "").trim();
  if (!cid) return true;
  const churchIds = [item?.churchId, (item as any)?.ownerChurchId, (item as any)?.sourceChurchId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return churchIds.includes(cid);
}

function scheduleFeedSlotCount(item: ChurchFeedItem): number {
  return Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0;
}

/** Same row source as GET /api/church/feed?scope=church for a target church. */
export async function listFeedRowsLikeGetChurchScope(targetChurchId: string): Promise<ChurchFeedItem[]> {
  const cid = String(targetChurchId || "").trim();
  if (!cid) return listFeedItems();

  let rawRows = await listFeedItemsForChurch(cid);
  if (!rawRows.length) {
    const fallbackRows = await listFeedItems();
    rawRows = fallbackRows.filter((item) => feedItemMatchesTargetChurch(item, cid));
  }

  return rawRows;
}

function findActiveChurchScheduleForFeedAlias(
  rows: ChurchFeedItem[],
  feedId: string,
  targetChurchId: string
): ChurchFeedItem | null {
  const cid = String(targetChurchId || "").trim();
  if (!cid) return null;

  const candidates = [
    findMediaScheduleFeedForChurch(rows, cid, { strictChurch: false }),
    findActiveMediaScheduleForChurch(rows, cid, { strictChurch: false }),
  ].filter(Boolean) as ChurchFeedItem[];

  for (const item of candidates) {
    if (feedItemMatchesScheduleFeedId(item, feedId)) return item;
  }

  let best: ChurchFeedItem | null = null;
  let bestCount = 0;
  for (const item of rows) {
    if (!isMediaScheduleFeedItem(item)) continue;
    if (!feedItemMatchesTargetChurch(item, cid)) continue;
    if (!feedItemMatchesScheduleFeedId(item, feedId)) continue;
    const count = scheduleFeedSlotCount(item);
    if (count >= bestCount) {
      best = item;
      bestCount = count;
    }
  }

  return best;
}

function pickBestScheduleFeedMatch(
  candidates: ChurchFeedItem[],
  feedId: string,
  targetChurchId?: string
): { item: ChurchFeedItem; matchedField: string } | null {
  if (!candidates.length) return null;

  const cid = String(targetChurchId || "").trim();
  let pool = candidates;
  if (cid) {
    const churchMatches = candidates.filter((item) => feedItemMatchesTargetChurch(item, cid));
    if (churchMatches.length) pool = churchMatches;
  }

  for (const item of pool) {
    if (String(item.id || "") === feedId) {
      return { item, matchedField: "id" };
    }
  }

  for (const field of SCHEDULE_FEED_ID_PAYLOAD_KEYS) {
    for (const item of pool) {
      if (String((item as any)[field] || "").trim() === feedId) {
        return { item, matchedField: field };
      }
    }
  }

  const sorted = pool
    .slice()
    .sort((a, b) => scheduleFeedSlotCount(b) - scheduleFeedSlotCount(a));
  if (!sorted.length) return null;
  return { item: sorted[0], matchedField: "best-match" };
}

async function findFeedItemByScheduleFeedIdDirect(
  feedId: string,
  targetChurchId?: string
): Promise<ChurchFeedItem | null> {
  const cid = String(targetChurchId || "").trim();
  const baseId = normalizeScheduleFeedIdBase(feedId);

  const aliasWhereSql = (sql: any) =>
    cid
      ? sql`
          SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
          FROM kristo_church_feed
          WHERE (
            church_id = ${cid}
            OR payload->>'ownerChurchId' = ${cid}
            OR payload->>'sourceChurchId' = ${cid}
          )
          AND (
            id = ${feedId}
            OR id = ${baseId}
            OR payload->>'sourceScheduleId' = ${feedId}
            OR payload->>'sourceScheduleId' = ${baseId}
            OR payload->>'liveId' = ${feedId}
            OR payload->>'liveId' = ${baseId}
            OR payload->>'liveScheduleFeedId' = ${feedId}
            OR payload->>'liveScheduleFeedId' = ${baseId}
            OR payload->>'scheduleFeedId' = ${feedId}
            OR payload->>'scheduleFeedId' = ${baseId}
            OR payload->>'parentScheduleId' = ${feedId}
            OR payload->>'parentScheduleId' = ${baseId}
            OR payload->>'postId' = ${feedId}
            OR payload->>'postId' = ${baseId}
            OR payload->>'feedId' = ${feedId}
            OR payload->>'feedId' = ${baseId}
          )
          ORDER BY
            CASE WHEN id = ${feedId} OR id = ${baseId} THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 12
        `
      : sql`
          SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
          FROM kristo_church_feed
          WHERE id = ${feedId}
             OR id = ${baseId}
             OR payload->>'sourceScheduleId' = ${feedId}
             OR payload->>'sourceScheduleId' = ${baseId}
             OR payload->>'liveId' = ${feedId}
             OR payload->>'liveId' = ${baseId}
             OR payload->>'liveScheduleFeedId' = ${feedId}
             OR payload->>'liveScheduleFeedId' = ${baseId}
             OR payload->>'scheduleFeedId' = ${feedId}
             OR payload->>'scheduleFeedId' = ${baseId}
             OR payload->>'parentScheduleId' = ${feedId}
             OR payload->>'parentScheduleId' = ${baseId}
             OR payload->>'postId' = ${feedId}
             OR payload->>'postId' = ${baseId}
             OR payload->>'feedId' = ${feedId}
             OR payload->>'feedId' = ${baseId}
          ORDER BY
            CASE WHEN id = ${feedId} OR id = ${baseId} THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 12
        `;

  if (usePostgres()) {
    const sql = getSql();
    let rows = await aliasWhereSql(sql);
    if (!(rows as FeedRow[]).length && cid) {
      rows = await sql`
        SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
        FROM kristo_church_feed
        WHERE id = ${feedId}
           OR id = ${baseId}
           OR payload->>'sourceScheduleId' = ${feedId}
           OR payload->>'sourceScheduleId' = ${baseId}
           OR payload->>'liveId' = ${feedId}
           OR payload->>'liveId' = ${baseId}
           OR payload->>'liveScheduleFeedId' = ${feedId}
           OR payload->>'liveScheduleFeedId' = ${baseId}
           OR payload->>'scheduleFeedId' = ${feedId}
           OR payload->>'scheduleFeedId' = ${baseId}
           OR payload->>'parentScheduleId' = ${feedId}
           OR payload->>'parentScheduleId' = ${baseId}
           OR payload->>'postId' = ${feedId}
           OR payload->>'postId' = ${baseId}
           OR payload->>'feedId' = ${feedId}
           OR payload->>'feedId' = ${baseId}
        ORDER BY
          CASE WHEN id = ${feedId} OR id = ${baseId} THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 12
      `;
    }
    const items = (rows as FeedRow[]).map((row) => rowToFeedItem(row));
    return pickBestScheduleFeedMatch(items, feedId, targetChurchId)?.item || null;
  }

  const scopeRows = cid ? await listFeedRowsLikeGetChurchScope(cid) : await readLocalFeedItems();
  const matches = scopeRows.filter((item) => feedItemMatchesScheduleFeedId(item, feedId));
  const picked = pickBestScheduleFeedMatch(matches, feedId, targetChurchId);
  if (picked) return picked.item;

  const all = await readLocalFeedItems();
  const globalMatches = all.filter((item) => feedItemMatchesScheduleFeedId(item, feedId));
  return pickBestScheduleFeedMatch(globalMatches, feedId, targetChurchId)?.item || null;
}

export async function resolveFeedItemByScheduleFeedId(input: {
  feedId: string;
  targetChurchId?: string;
}): Promise<{
  item: ChurchFeedItem | null;
  matchedBy: "direct" | "church-scope" | "global-scan" | "active-schedule" | null;
  matchedField: string | null;
  scannedCount: number;
}> {
  const feedId = String(input.feedId || "").trim();
  const targetChurchId = String(input.targetChurchId || "").trim();
  if (!feedId) {
    return { item: null, matchedBy: null, matchedField: null, scannedCount: 0 };
  }

  await ensureFeedStoreReady();

  const direct = await findFeedItemByScheduleFeedIdDirect(feedId, targetChurchId);
  if (direct && (!targetChurchId || feedItemMatchesTargetChurch(direct, targetChurchId))) {
    const matchedField =
      String(direct.id || "") === feedId
        ? "id"
        : SCHEDULE_FEED_ID_PAYLOAD_KEYS.find((key) =>
            feedItemMatchesScheduleFeedId({ ...direct, [key]: (direct as any)[key] }, feedId)
          ) || "alias";
    return {
      item: direct,
      matchedBy: "direct",
      matchedField,
      scannedCount: 1,
    };
  }

  const churchRows = targetChurchId ? await listFeedRowsLikeGetChurchScope(targetChurchId) : [];
  const churchMatches = churchRows.filter((item) => feedItemMatchesScheduleFeedId(item, feedId));
  const churchPicked = pickBestScheduleFeedMatch(churchMatches, feedId, targetChurchId);
  if (churchPicked) {
    return {
      item: churchPicked.item,
      matchedBy: "church-scope",
      matchedField: churchPicked.matchedField,
      scannedCount: churchRows.length,
    };
  }

  const activeMatch = targetChurchId
    ? findActiveChurchScheduleForFeedAlias(churchRows, feedId, targetChurchId)
    : null;
  if (activeMatch) {
    return {
      item: activeMatch,
      matchedBy: "active-schedule",
      matchedField: "active-schedule",
      scannedCount: churchRows.length,
    };
  }

  const all = await listFeedItems();
  const matches = all.filter((item) => feedItemMatchesScheduleFeedId(item, feedId));
  const picked = pickBestScheduleFeedMatch(matches, feedId, targetChurchId);
  if (picked) {
    return {
      item: picked.item,
      matchedBy: "global-scan",
      matchedField: picked.matchedField,
      scannedCount: all.length,
    };
  }

  const globalActive = targetChurchId
    ? findActiveChurchScheduleForFeedAlias(all, feedId, targetChurchId)
    : null;
  if (globalActive) {
    return {
      item: globalActive,
      matchedBy: "active-schedule",
      matchedField: "active-schedule-global",
      scannedCount: all.length,
    };
  }

  if (targetChurchId && feedId.startsWith("feed_")) {
    const scopedRows = churchRows.length ? churchRows : await listFeedRowsLikeGetChurchScope(targetChurchId);
    const mediaRows = scopedRows.filter(
      (item) => isMediaScheduleFeedItem(item) && scheduleFeedSlotCount(item) > 0
    );
    if (mediaRows.length === 1) {
      return {
        item: mediaRows[0],
        matchedBy: "church-scope",
        matchedField: "single-church-schedule",
        scannedCount: scopedRows.length,
      };
    }
  }

  return { item: null, matchedBy: null, matchedField: null, scannedCount: all.length };
}

export async function getFeedItemById(id: string): Promise<ChurchFeedItem | null> {
  const feedId = String(id || "").trim();
  if (!feedId) return null;
  return findFeedItemByScheduleFeedIdDirect(feedId);
}

export type FeedItemDebugSnapshot = {
  store: "postgres" | "local";
  item: ChurchFeedItem;
  rawPayload: Record<string, unknown> | null;
  rowMeta: {
    id: string;
    churchId: string;
    type: string;
    source: string | null;
    scheduleType: string | null;
    createdBy: string;
    visibility: string | null;
    createdAt: string;
    updatedAt: string | null;
  };
};

export async function getFeedItemDebugSnapshot(id: string): Promise<FeedItemDebugSnapshot | null> {
  const feedId = String(id || "").trim();
  if (!feedId) return null;
  await ensureFeedStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
      FROM kristo_church_feed
      WHERE id = ${feedId}
      LIMIT 1
    `;
    const row = (rows as FeedRow[])[0];
    if (!row) return null;

    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : null;

    return {
      store: "postgres",
      item: rowToFeedItem(row),
      rawPayload: payload,
      rowMeta: {
        id: row.id,
        churchId: row.church_id,
        type: row.type,
        source: row.source,
        scheduleType: row.schedule_type,
        createdBy: row.created_by,
        visibility: row.visibility,
        createdAt: String(row.created_at || ""),
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      },
    };
  }

  const all = await readLocalFeedItems();
  const direct = all.find((x) => String(x.id || "") === feedId);
  if (!direct) return null;

  return {
    store: "local",
    item: direct,
    rawPayload: { ...direct },
    rowMeta: {
      id: String(direct.id || ""),
      churchId: String(direct.churchId || ""),
      type: String(direct.type || ""),
      source: direct.source ? String(direct.source) : null,
      scheduleType: direct.scheduleType ? String(direct.scheduleType) : null,
      createdBy: String(direct.createdBy || ""),
      visibility: direct.visibility ? String(direct.visibility) : null,
      createdAt: String(direct.createdAt || ""),
      updatedAt: null,
    },
  };
}

function normalizeFeedVideoUrl(url: unknown) {
  return String(url || "").trim().split("?")[0];
}

export async function patchFeedItemsPosterByVideoUrl(
  videoUrl: string,
  posterUri: string
): Promise<number> {
  await ensureFeedStoreReady();
  const target = normalizeFeedVideoUrl(videoUrl);
  const poster = String(posterUri || "").trim();
  if (!target || !poster) return 0;

  const items = await listFeedItems();
  let patched = 0;

  for (const item of items) {
    const itemUrl = normalizeFeedVideoUrl(item.videoUrl);
    if (!itemUrl || itemUrl !== target) continue;

    const existingPoster = String(item.posterUri || item.videoPosterUri || "").trim();
    if (existingPoster === poster) continue;

    await upsertFeedItem({
      ...item,
      posterUri: poster,
      videoPosterUri: poster,
      thumbnailUri: poster,
    });
    patched += 1;
  }

  if (patched > 0) {
    console.log("KRISTO_VIDEO_POSTER_FEED_PATCHED", {
      videoUrl: target,
      posterUri: poster,
      patchedCount: patched,
    });
  }

  return patched;
}

export async function patchFeedItemsFaststartByVideoUrl(videoUrl: string): Promise<number> {
  await ensureFeedStoreReady();
  const target = normalizeFeedVideoUrl(videoUrl);
  if (!target) return 0;

  const items = await listFeedItems();
  let patched = 0;

  for (const item of items) {
    const itemUrl = normalizeFeedVideoUrl(item.videoUrl);
    if (!itemUrl || itemUrl !== target) continue;
    if (item.faststart === true || item.hasFaststart === true) continue;

    await upsertFeedItem({
      ...item,
      faststart: true,
      hasFaststart: true,
    });
    patched += 1;
  }

  if (patched > 0) {
    console.log("KRISTO_VIDEO_FASTSTART_FEED_PATCHED", {
      videoUrl: target,
      patchedCount: patched,
    });
  }

  return patched;
}

export async function upsertFeedItem(item: ChurchFeedItem): Promise<ChurchFeedItem> {
  await ensureFeedStoreReady();

  const id = String(item.id || "").trim();
  const churchId = String(item.churchId || "").trim();
  if (!id || !churchId) throw new Error("Feed item id and churchId are required");

  const payload = feedItemToPayload(item);
  const imageFields = extractFeedImageFields(payload as Record<string, unknown>);
  const posterFields = extractFeedVideoPosterFields(payload as Record<string, unknown>);
  const next: ChurchFeedItem = {
    ...payload,
    ...imageFields,
    ...posterFields,
    id,
    churchId,
    createdAt: payload.createdAt || nowIso(),
  };

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_church_feed (
        id, church_id, type, source, schedule_type, created_by, visibility, payload, created_at, updated_at
      ) VALUES (
        ${id},
        ${churchId},
        ${String(next.type || "post")},
        ${next.source || null},
        ${next.scheduleType || null},
        ${String(next.createdBy || "")},
        ${next.visibility || null},
        ${next as any},
        ${next.createdAt},
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        church_id = EXCLUDED.church_id,
        type = EXCLUDED.type,
        source = EXCLUDED.source,
        schedule_type = EXCLUDED.schedule_type,
        created_by = EXCLUDED.created_by,
        visibility = EXCLUDED.visibility,
        payload = EXCLUDED.payload,
        updated_at = NOW()
    `;

    console.log("[FeedDb] upsert ok", {
      id,
      churchId,
      source: next.source || null,
      scheduleType: next.scheduleType || null,
      slotCount: Array.isArray(next.scheduleSlots) ? next.scheduleSlots.length : 0,
    });
    return next;
  }

  const all = await readLocalFeedItems();
  const index = all.findIndex((x) => String(x.id || "") === id);
  if (index >= 0) all[index] = next;
  else all.push(next);
  await writeLocalFeedItems(all);

  console.log("[FeedDb] upsert ok", {
    id,
    churchId,
    source: next.source || null,
    scheduleType: next.scheduleType || null,
    slotCount: Array.isArray(next.scheduleSlots) ? next.scheduleSlots.length : 0,
  });
  return next;
}

export async function deleteFeedItemById(id: string): Promise<boolean> {
  const feedId = String(id || "").trim();
  if (!feedId) return false;
  await ensureFeedStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    await sql`DELETE FROM kristo_church_feed WHERE id = ${feedId}`;
    return true;
  }

  const all = await readLocalFeedItems();
  const next = all.filter((x) => String(x.id || "") !== feedId);
  if (next.length === all.length) return false;
  await writeLocalFeedItems(next);
  return true;
}

export async function deleteFeedItemsWhere(
  predicate: (item: ChurchFeedItem) => boolean
): Promise<number> {
  await ensureFeedStoreReady();
  const all = await listFeedItems();
  const toDelete = all.filter(predicate);
  if (!toDelete.length) return 0;

  if (usePostgres()) {
    const sql = getSql();
    for (const item of toDelete) {
      await sql`DELETE FROM kristo_church_feed WHERE id = ${item.id}`;
    }
    return toDelete.length;
  }

  const ids = new Set(toDelete.map((x) => x.id));
  const next = all.filter((x) => !ids.has(x.id));
  await writeLocalFeedItems(next);
  return toDelete.length;
}

export async function dbCountFeedItems(): Promise<number> {
  await ensureFeedStoreReady();
  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`SELECT COUNT(*)::int AS count FROM kristo_church_feed`;
    return Number((rows as any[])?.[0]?.count || 0);
  }
  const all = await readLocalFeedItems();
  return all.length;
}

export function isFeedDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("feed database not configured") ||
    message.includes("database_url not configured")
  );
}
