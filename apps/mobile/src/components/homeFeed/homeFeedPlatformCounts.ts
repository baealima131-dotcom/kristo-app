/**
 * Fields of an external video link (YouTube/TikTok/Facebook) that change on the server while the
 * post stays the same: platform counts and which counts are unavailable or hidden. Order, ids,
 * covers and everything else are left as they are.
 *
 * Dependency-free so it can be unit tested in Node (scripts/homeFeedPlatformCountsRefresh.test.ts).
 */
export const EXTERNAL_PLATFORM_REFRESH_FIELDS = [
  "platformStats",
  "platformUnavailableFields",
  "platformHiddenFields",
  "platformStatsUpdatedAt",
  "facebookManualStats",
] as const;

function isExternalVideoLinkRow(row: any): boolean {
  return String(row?.source || "").trim().toLowerCase() === "system-admin-video-link";
}

/**
 * Refresh the platform counts of rows already loaded, from fresh rows with the same key.
 * Never adds, removes or reorders rows; returns the same array when nothing changed, and keeps
 * the same object for every row whose counts did not change.
 */
export function refreshRowsPlatformFields(
  existing: any[],
  fresh: any[],
  rowKey: (row: any) => string
): { rows: any[]; updated: number } {
  if (!existing.length || !fresh.length) return { rows: existing, updated: 0 };
  const freshByKey = new Map<string, any>();
  for (const row of fresh) {
    if (!isExternalVideoLinkRow(row)) continue;
    const key = rowKey(row);
    if (key) freshByKey.set(key, row);
  }
  if (!freshByKey.size) return { rows: existing, updated: 0 };

  let updated = 0;
  const rows = existing.map((row) => {
    if (!isExternalVideoLinkRow(row)) return row;
    const next = freshByKey.get(rowKey(row));
    if (!next) return row;
    let patch: Record<string, unknown> | null = null;
    for (const field of EXTERNAL_PLATFORM_REFRESH_FIELDS) {
      // A field the fresh row does not carry at all is left alone (never wiped).
      if (!(field in next)) continue;
      if (JSON.stringify(row?.[field] ?? null) === JSON.stringify(next[field] ?? null)) continue;
      (patch ||= {})[field] = next[field];
    }
    if (!patch) return row;
    updated += 1;
    return { ...row, ...patch };
  });
  return updated ? { rows, updated } : { rows: existing, updated: 0 };
}

/**
 * Platform counts and flags of an external video link as one string ("" for other rows), so
 * equality checks that compare rows by id still notice new counts for the same post.
 */
export function externalPlatformFieldsDigest(row: any): string {
  if (!isExternalVideoLinkRow(row)) return "";
  return EXTERNAL_PLATFORM_REFRESH_FIELDS.map((field) => JSON.stringify(row?.[field] ?? null)).join("|");
}
