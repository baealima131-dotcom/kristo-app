/**
 * Home Feed video search helpers (PII-safe, substring match).
 * Applied after eligibility filters and before pagination.
 */

export const HOME_FEED_SEARCH_MAX_QUERY_LENGTH = 100;

/** Trim, lowercase, collapse whitespace. Empty → "". */
export function normalizeHomeFeedSearchQuery(input: unknown): string {
  if (input == null) return "";
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse `q` from the request URL.
 * - missing/empty → no search (normal feed)
 * - repeated conflicting values → rejected (treated as no search)
 * - non-string / object-like → rejected
 * - length capped at HOME_FEED_SEARCH_MAX_QUERY_LENGTH
 */
export function parseHomeFeedSearchQueryParam(
  searchParams: URLSearchParams
): {
  normalizedQuery: string;
  active: boolean;
  rejected: boolean;
  reason: string;
} {
  const all = searchParams.getAll("q");
  if (all.length === 0) {
    return { normalizedQuery: "", active: false, rejected: false, reason: "absent" };
  }
  if (all.length > 1) {
    const norms = all.map((v) => normalizeHomeFeedSearchQuery(v));
    const first = norms[0] || "";
    if (!norms.every((n) => n === first)) {
      return { normalizedQuery: "", active: false, rejected: true, reason: "repeated-conflict" };
    }
  }

  const raw = all[0];
  if (typeof raw !== "string") {
    return { normalizedQuery: "", active: false, rejected: true, reason: "malformed-type" };
  }

  let normalized = normalizeHomeFeedSearchQuery(raw);
  if (!normalized) {
    return { normalizedQuery: "", active: false, rejected: false, reason: "empty" };
  }
  if (normalized.length > HOME_FEED_SEARCH_MAX_QUERY_LENGTH) {
    normalized = normalized.slice(0, HOME_FEED_SEARCH_MAX_QUERY_LENGTH);
  }
  return { normalizedQuery: normalized, active: true, rejected: false, reason: "ok" };
}

function fieldText(value: unknown): string {
  return String(value ?? "").trim();
}

/** Logical haystack aligned with mobile Home Feed search (+ ministry name). */
export function buildHomeFeedSearchHaystack(item: any): string {
  if (!item || typeof item !== "object") return "";

  const postTypeTitle = (() => {
    const type = fieldText(item?.type || item?.kind || item?.source).toLowerCase();
    if (!type) return "";
    if (type === "video" || type === "media-upload" || type === "media") return "video";
    return type.replace(/[-_]/g, " ");
  })();

  const identityHeadline = fieldText(
    item?.actorLabel || item?.authorName || item?.churchName || item?.churchLabel
  );

  const ministryName = fieldText(
    item?.ministryName ||
      item?.ministry?.name ||
      item?.roomName ||
      item?.ministryTitle ||
      item?.ministryLabel
  );

  const parts = [
    item?.title,
    item?.text,
    item?.caption,
    item?.body,
    item?.description,
    item?.churchName,
    item?.churchLabel,
    item?.mediaName,
    identityHeadline,
    postTypeTitle,
    item?.authorName,
    item?.author?.name,
    item?.postedByName,
    item?.displayName,
    item?.profileName,
    item?.fullName,
    item?.actorLabel,
    ministryName,
  ];

  return parts
    .map((part) => normalizeHomeFeedSearchQuery(part))
    .filter(Boolean)
    .join(" ");
}

export function homeFeedItemMatchesSearchQuery(item: any, normalizedQuery: string): boolean {
  const needle = normalizeHomeFeedSearchQuery(normalizedQuery);
  if (!needle) return true;
  return buildHomeFeedSearchHaystack(item).includes(needle);
}

export function filterHomeFeedRowsBySearchQuery<T>(rows: T[], normalizedQuery: string): T[] {
  const needle = normalizeHomeFeedSearchQuery(normalizedQuery);
  if (!needle) return Array.isArray(rows) ? rows : [];
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => homeFeedItemMatchesSearchQuery(row, needle));
}
