import { feedRenderKey } from "@/src/components/homeFeed/homeFeedUtils";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

/** Stable post identity for poster session invalidation — ignores slot/render aliases. */
export function normalizePosterFeedPostId(row: any): string {
  const raw = row?.id ?? row;
  const normalized = baseFeedId(raw);
  if (normalized) return normalized;
  return String(raw || "").trim();
}

export function buildRawPosterFeedKey(rows: any[], count = 8): string {
  return rows
    .slice(0, count)
    .map((row) => String(row?.id || "").trim())
    .filter(Boolean)
    .join("|");
}

export function buildRawPosterInitialSignature(rows: any[], count = 8): string {
  return rows
    .slice(0, count)
    .map((row) => feedRenderKey(row) || String(row?.id || "").trim())
    .filter(Boolean)
    .join("|");
}

function collectNormalizedIds(rows: any[], startIndex: number, count: number): string[] {
  const end = Math.min(rows.length, Math.max(0, startIndex) + Math.max(0, count));
  const ids: string[] = [];
  for (let i = Math.max(0, startIndex); i < end; i += 1) {
    const normalized = normalizePosterFeedPostId(rows[i]);
    if (normalized) ids.push(normalized);
  }
  return ids;
}

/** Sorted unique normalized ids from the first `count` feed rows. */
export function buildNormalizedPosterFeedKey(rows: any[], count = 8): string {
  const unique = [...new Set(collectNormalizedIds(rows, 0, count))];
  unique.sort();
  return unique.join("|");
}

/** Sorted unique normalized ids from visible video post rows. */
export function buildNormalizedPosterVisibleKey(items: any[]): string {
  const unique = [
    ...new Set(items.map((item) => normalizePosterFeedPostId(item)).filter(Boolean)),
  ];
  unique.sort();
  return unique.join("|");
}

export function buildRawPosterVisibleSignature(items: any[]): string {
  return items
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean)
    .join("|");
}

export function posterFeedIdentitySetsEqual(a: string, b: string): boolean {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left === right) return true;
  const setA = new Set(left.split("|").filter(Boolean));
  const setB = new Set(right.split("|").filter(Boolean));
  if (setA.size !== setB.size) return false;
  for (const id of setA) {
    if (!setB.has(id)) return false;
  }
  return true;
}

export function diffNormalizedPosterIds(prevKey: string, nextKey: string) {
  const prevIds = String(prevKey || "")
    .split("|")
    .filter(Boolean);
  const nextIds = String(nextKey || "")
    .split("|")
    .filter(Boolean);
  const previousSet = new Set(prevIds);
  const nextSet = new Set(nextIds);
  return {
    removed: prevIds.filter((id) => !nextSet.has(id)),
    added: nextIds.filter((id) => !previousSet.has(id)),
  };
}

export function describePosterFeedIdentity(rows: any[], count = 8) {
  const rawFeedKey = buildRawPosterFeedKey(rows, count);
  const normalizedFeedKey = buildNormalizedPosterFeedKey(rows, count);
  const rawInitialSignature = buildRawPosterInitialSignature(rows, count);
  const normalizedInitialSignature = normalizedFeedKey;
  return {
    rawFeedKey: rawFeedKey || null,
    normalizedFeedKey: normalizedFeedKey || null,
    rawInitialSignature: rawInitialSignature || null,
    normalizedInitialSignature: normalizedInitialSignature || null,
    normalizedRowIds: normalizedFeedKey ? normalizedFeedKey.split("|").filter(Boolean) : [],
    rawRowIds: rawFeedKey ? rawFeedKey.split("|").filter(Boolean) : [],
  };
}

export function describePosterVisibleIdentity(items: any[]) {
  const rawVisibleSignature = buildRawPosterVisibleSignature(items);
  const normalizedVisibleSignature = buildNormalizedPosterVisibleKey(items);
  return {
    rawVisibleSignature: rawVisibleSignature || null,
    normalizedVisibleSignature: normalizedVisibleSignature || null,
    rawRowIds: rawVisibleSignature ? rawVisibleSignature.split("|").filter(Boolean) : [],
    normalizedRowIds: normalizedVisibleSignature
      ? normalizedVisibleSignature.split("|").filter(Boolean)
      : [],
  };
}
