/** Slim YouTube Home Feed rows for AsyncStorage — first-paint fields only. */

const CACHE_TEXT_MAX = 512;
const CACHE_FIELD_MAX = 2048;

const SLIM_STRING_FIELDS = [
  "id",
  "feedOriginId",
  "homeFeedRecycleKey",
  "videoUrl",
  "videoUri",
  "mediaUrl",
  "mediaUri",
  "url",
  "mediaVideoUrl",
  "playbackUrl",
  "posterUri",
  "videoPosterUri",
  "thumbnailUri",
  "thumbnailUrl",
  "posterUrl",
  "coverUrl",
  "firstFrameUrl",
  "mediaPosterUri",
  "previewUrl",
  "type",
  "kind",
  "source",
  "mediaType",
  "title",
  "body",
  "text",
  "authorName",
  "actorLabel",
  "postedByName",
  "displayName",
  "churchName",
  "churchId",
  "mediaId",
  "mediaName",
  "authorAvatarUri",
  "actorAvatarUri",
  "profileAvatarUri",
  "authorAvatar",
  "churchAvatarUri",
  "churchAvatarUrl",
  "churchAvatar",
  "churchLogoUrl",
  "churchLogoUri",
  "avatarUri",
  "avatarUrl",
  "profileImage",
  "photoURL",
  "mediaAvatarUri",
  "mediaLogoUrl",
  "ownershipType",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "status",
  "scheduleStatus",
  "mediaStatus",
  "scheduleType",
  "parentScheduleId",
  "sourceScheduleId",
] as const;

const SLIM_NUMBER_FIELDS = [
  "likeCount",
  "commentCount",
  "replyCount",
  "shareCount",
  "saveCount",
  "durationMs",
  "videoDurationMs",
  "duration",
  "churchAvatarUpdatedAt",
  "avatarUpdatedAt",
] as const;

const TEXT_TRIM_FIELDS = new Set(["body", "text", "title"]);

export const HOME_FEED_PAGE_CACHE_MAX_ROW_BYTES = 12_000;

function trimCacheString(value: unknown, key: string): string {
  let text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith("data:")) return "";
  if (key === "localVideoUri" || (key.includes("Uri") && text.startsWith("file://"))) {
    return "";
  }
  const maxLen = TEXT_TRIM_FIELDS.has(key) ? CACHE_TEXT_MAX : CACHE_FIELD_MAX;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen);
  }
  return text;
}

export function slimHomeFeedPageCacheRow(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;

  const input = row as Record<string, unknown>;
  if (input.__homeFeedSkeleton === true) {
    const id = String(input.id || "").trim();
    return id ? { __homeFeedSkeleton: true, id } : null;
  }

  const out: Record<string, unknown> = { __cacheSlim: true };

  for (const key of SLIM_STRING_FIELDS) {
    const value = trimCacheString(input[key], key);
    if (value) out[key] = value;
  }

  for (const key of SLIM_NUMBER_FIELDS) {
    const value = Number(input[key]);
    if (!Number.isFinite(value)) continue;
    out[key] = value;
  }

  if (input.homeFeedSlotExpanded === true) out.homeFeedSlotExpanded = true;
  if (input.deleted === true) out.deleted = true;
  if (input.isLiveNow === true) out.isLiveNow = true;

  if (!String(out.id || "").trim()) return null;
  return out;
}

export function slimHomeFeedPageCacheRows(rows: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  const slimmed: Record<string, unknown>[] = [];
  for (const row of rows) {
    const slim = slimHomeFeedPageCacheRow(row);
    if (slim) slimmed.push(slim);
  }
  return slimmed;
}

function normalizeHomeFeedApiRowLazy(row: any) {
  const { normalizeHomeFeedApiRow } = require("@/src/components/homeFeed/homeFeedUtils") as {
    normalizeHomeFeedApiRow: (input: any) => any;
  };
  return normalizeHomeFeedApiRow(row);
}

export function expandHomeFeedPageCacheRow(row: unknown): any {
  if (!row || typeof row !== "object") return row;
  const input = row as Record<string, unknown>;
  if (input.__homeFeedSkeleton === true) return row;
  const { __cacheSlim, ...rest } = input;
  return normalizeHomeFeedApiRowLazy(rest);
}

export function expandHomeFeedPageCacheRows(rows: unknown[]): any[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => expandHomeFeedPageCacheRow(row));
}

export function estimateHomeFeedPageCacheRowBytes(row: Record<string, unknown>): number {
  return JSON.stringify(row).length;
}

export function summarizeHomeFeedPageCacheRowBytes(rows: Record<string, unknown>[]) {
  let totalBytes = 0;
  let maxRowBytes = 0;
  let maxFieldKey = "";
  let maxFieldBytes = 0;

  for (const row of rows) {
    const rowBytes = estimateHomeFeedPageCacheRowBytes(row);
    totalBytes += rowBytes;
    if (rowBytes > maxRowBytes) maxRowBytes = rowBytes;

    for (const [key, value] of Object.entries(row)) {
      const fieldBytes = String(value ?? "").length;
      if (fieldBytes > maxFieldBytes) {
        maxFieldBytes = fieldBytes;
        maxFieldKey = key;
      }
    }
  }

  return {
    totalBytes,
    rowCount: rows.length,
    maxRowBytes,
    maxFieldKey,
    maxFieldBytes,
    avgRowBytes: rows.length ? Math.round(totalBytes / rows.length) : 0,
  };
}
