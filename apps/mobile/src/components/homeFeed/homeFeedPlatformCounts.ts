/**
 * Fields of a post that change on the server while the post stays the same, refreshed in place on
 * rows already loaded (Home Feed background refresh). Order, ids, titles, covers, video and
 * everything else are left as they are.
 *
 * Dependency-free so it can be unit tested in Node (scripts/homeFeedPlatformCountsRefresh.test.ts).
 */

/** External video link (YouTube/TikTok/Facebook): platform counts and unavailable/hidden flags. */
export const EXTERNAL_PLATFORM_REFRESH_FIELDS = [
  "platformStats",
  "platformUnavailableFields",
  "platformHiddenFields",
  "platformStatsUpdatedAt",
  "facebookManualStats",
] as const;

/**
 * Any post: the church's current picture. The feed API sends the church profile's picture with
 * every post (not a copy saved with the post), so a new Church Profile photo reaches old posts.
 */
export const CHURCH_IDENTITY_REFRESH_FIELDS = [
  "churchAvatarUri",
  "churchAvatarUrl",
  "churchAvatar",
  "churchImage",
  "churchProfileImage",
  "churchLogo",
  "churchLogoUri",
  "churchLogoUrl",
  "ownerChurchAvatarUri",
  "churchAvatarUpdatedAt",
  "avatarUpdatedAt",
] as const;

function isExternalVideoLinkRow(row: any): boolean {
  return String(row?.source || "").trim().toLowerCase() === "system-admin-video-link";
}

function refreshFieldsFor(row: any): readonly string[] {
  return isExternalVideoLinkRow(row)
    ? [...EXTERNAL_PLATFORM_REFRESH_FIELDS, ...CHURCH_IDENTITY_REFRESH_FIELDS]
    : CHURCH_IDENTITY_REFRESH_FIELDS;
}

/**
 * Refresh the changeable fields of rows already loaded, from fresh rows with the same key.
 * Never adds, removes or reorders rows; returns the same array when nothing changed, and keeps
 * the same object for every row whose fields did not change.
 */
export function refreshRowsPlatformFields(
  existing: any[],
  fresh: any[],
  rowKey: (row: any) => string
): { rows: any[]; updated: number } {
  if (!existing.length || !fresh.length) return { rows: existing, updated: 0 };
  const freshByKey = new Map<string, any>();
  for (const row of fresh) {
    const key = rowKey(row);
    if (key) freshByKey.set(key, row);
  }
  if (!freshByKey.size) return { rows: existing, updated: 0 };

  let updated = 0;
  const rows = existing.map((row) => {
    const next = freshByKey.get(rowKey(row));
    if (!next) return row;
    let patch: Record<string, unknown> | null = null;
    for (const field of refreshFieldsFor(next)) {
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
 * The refreshable fields of a row as one string, so equality checks that compare rows by id still
 * notice new platform counts or a new church picture for the same post.
 */
export function externalPlatformFieldsDigest(row: any): string {
  return refreshFieldsFor(row).map((field) => JSON.stringify(row?.[field] ?? null)).join("|");
}
