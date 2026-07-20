/**
 * Backend-backed Home Feed video search.
 * Isolated from normal feed paging / session authority.
 */
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleFeedParse";
import {
  buildHomeFeedVideoOpenPayload,
  feedRenderKey,
  filterHomeFeedYoutubeStreamRows,
  normalizeHomeFeedApiRow,
  normalizeHomeFeedSearchQuery,
} from "./homeFeedUtils";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";

export const HOME_FEED_SEARCH_PAGE_SIZE = 40;
export const HOME_FEED_SEARCH_DEBOUNCE_MS = 300;
export const HOME_FEED_SEARCH_MAX_QUERY_LENGTH = 100;

export type HomeFeedSearchDisposition =
  | "network"
  | "failed"
  | "malformed"
  | "stale-cancelled"
  | "empty-query"
  | "skipped";

export type HomeFeedSearchSelectionAction =
  | {
      action: "open-watch";
      rowKey: string;
      row: any;
      payload: HomeFeedVideoOpenPayload;
      inFeed: boolean;
      preserveFeedOrder: true;
    }
  | { action: "noop"; rowKey: string; reason: string; inFeed: boolean; preserveFeedOrder: false };

export function homeFeedSearchRowKey(row: any): string {
  return feedRenderKey(row) || String(row?.id || "").trim();
}

export function isHomeFeedSearchRowInFeed(row: any, feedRows: any[]): boolean {
  const rowKey = homeFeedSearchRowKey(row);
  if (!rowKey || !Array.isArray(feedRows)) return false;
  return feedRows.some((candidate) => homeFeedSearchRowKey(candidate) === rowKey);
}

/**
 * Every search result opens Watch on the exact selected video.
 * Never scrolls the Home Feed. Never mutates paging/session/order.
 */
export function resolveHomeFeedSearchSelection(args: {
  selectedRow: any;
  feedRows: any[];
}): HomeFeedSearchSelectionAction {
  const row = args.selectedRow;
  const rowKey = homeFeedSearchRowKey(row);
  const inFeed = isHomeFeedSearchRowInFeed(row, args.feedRows);
  if (!rowKey) {
    return { action: "noop", rowKey: "", reason: "missing-row-key", inFeed, preserveFeedOrder: false };
  }

  const payload = buildHomeFeedVideoOpenPayload(row);
  if (!payload) {
    return {
      action: "noop",
      rowKey,
      reason: "missing-watch-payload",
      inFeed,
      preserveFeedOrder: false,
    };
  }
  return {
    action: "open-watch",
    rowKey,
    row,
    payload,
    inFeed,
    preserveFeedOrder: true,
  };
}

/** Build search query string with safe URL encoding for `q`. */
export function buildHomeFeedSearchRequestPath(args: {
  query: string;
  cursor?: string | null;
  limit?: number;
}): { path: string; normalizedQuery: string; normalizedQueryLength: number } {
  const normalized = clampNormalizedQuery(args.query);
  const limit = Math.min(
    Math.max(1, Math.floor(args.limit || HOME_FEED_SEARCH_PAGE_SIZE)),
    100
  );
  const cursor = String(args.cursor ?? "0").trim() || "0";
  const params = new URLSearchParams({
    scope: "global",
    mediaOnly: "1",
    q: normalized,
    limit: String(limit),
    cursor,
    _: String(Date.now()),
  });
  return {
    path: `/api/church/feed?${params.toString()}`,
    normalizedQuery: normalized,
    normalizedQueryLength: normalized.length,
  };
}

export type HomeFeedSearchFetchResult = {
  disposition: HomeFeedSearchDisposition;
  rawCount: number;
  mappedCount: number;
  total: number | null;
  hasMore: boolean;
  nextCursor: string | null;
  rows: any[];
  reason: string;
  staleIgnored: boolean;
  generation: number;
  normalizedQueryLength: number;
};

function clampNormalizedQuery(query: string): string {
  const n = normalizeHomeFeedSearchQuery(query);
  if (!n) return "";
  return n.length > HOME_FEED_SEARCH_MAX_QUERY_LENGTH
    ? n.slice(0, HOME_FEED_SEARCH_MAX_QUERY_LENGTH)
    : n;
}

function parseSearchRows(res: any): any[] {
  const raw = parseChurchFeedListResponse(res).rows.map(normalizeHomeFeedApiRow);
  return filterHomeFeedYoutubeStreamRows(raw);
}

function readSearchPaging(res: any): {
  total: number | null;
  hasMore: boolean;
  nextCursor: string | null;
} {
  if (!res || typeof res !== "object") {
    return { total: null, hasMore: false, nextCursor: null };
  }
  const totalRaw = (res as any).total;
  const total =
    typeof totalRaw === "number" && Number.isFinite(totalRaw) ? Math.max(0, totalRaw) : null;
  const hasMore = (res as any).hasMore === true;
  const next =
    (res as any).nextCursor != null && String((res as any).nextCursor).trim()
      ? String((res as any).nextCursor)
      : null;
  return { total, hasMore, nextCursor: next };
}

/**
 * Distinct request identity: screen `HomeFeedSearch`, throttleMs 0, dedupe false.
 * Does not touch Home Feed session/paging caches.
 */
export async function fetchHomeFeedVideoSearchPage(args: {
  query: string;
  cursor?: string | null;
  limit?: number;
  generation: number;
  isCurrentGeneration: (generation: number) => boolean;
}): Promise<HomeFeedSearchFetchResult> {
  const normalized = clampNormalizedQuery(args.query);
  const normalizedQueryLength = normalized.length;
  const generation = args.generation;

  if (!normalized) {
    return {
      disposition: "empty-query",
      rawCount: 0,
      mappedCount: 0,
      total: null,
      hasMore: false,
      nextCursor: null,
      rows: [],
      reason: "empty-query",
      staleIgnored: false,
      generation,
      normalizedQueryLength: 0,
    };
  }

  if (!args.isCurrentGeneration(generation)) {
    return {
      disposition: "stale-cancelled",
      rawCount: 0,
      mappedCount: 0,
      total: null,
      hasMore: false,
      nextCursor: null,
      rows: [],
      reason: "stale-before-request",
      staleIgnored: true,
      generation,
      normalizedQueryLength,
    };
  }

  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const built = buildHomeFeedSearchRequestPath({
    query: normalized,
    cursor: args.cursor,
    limit: args.limit,
  });

  console.log("KRISTO_HOME_FEED_SEARCH_REQUEST", {
    normalizedQueryLength,
    generation,
    cursorPresent: true,
    requestStarted: true,
    reason: "fetch",
  });

  try {
    const res: any = await apiGet(
      built.path,
      {
        headers: getKristoHeaders({
          userId: viewerUserId,
          role: (session?.role || "Member") as any,
          churchId: String(session?.churchId || "").trim(),
        }),
        cache: "no-store" as RequestCache,
      },
      { screen: "HomeFeedSearch", throttleMs: 0, dedupe: false }
    );

    if (!args.isCurrentGeneration(generation)) {
      console.log("KRISTO_HOME_FEED_SEARCH_DECISION", {
        normalizedQueryLength,
        generation,
        disposition: "stale-cancelled",
        staleIgnored: true,
        reason: "stale-after-response",
        rawCount: 0,
        mappedCount: 0,
        total: null,
        hasMore: false,
      });
      return {
        disposition: "stale-cancelled",
        rawCount: 0,
        mappedCount: 0,
        total: null,
        hasMore: false,
        nextCursor: null,
        rows: [],
        reason: "stale-after-response",
        staleIgnored: true,
        generation,
        normalizedQueryLength,
      };
    }

    if (!res || typeof res !== "object" || res.ok === false) {
      console.log("KRISTO_HOME_FEED_SEARCH_RESULT", {
        normalizedQueryLength,
        generation,
        disposition: "failed",
        rawCount: 0,
        mappedCount: 0,
        total: null,
        hasMore: false,
        staleIgnored: false,
        reason: "failed",
      });
      return {
        disposition: "failed",
        rawCount: 0,
        mappedCount: 0,
        total: null,
        hasMore: false,
        nextCursor: null,
        rows: [],
        reason: "failed",
        staleIgnored: false,
        generation,
        normalizedQueryLength,
      };
    }

    const paging = readSearchPaging(res);
    if (typeof (res as any).hasMore !== "boolean") {
      console.log("KRISTO_HOME_FEED_SEARCH_RESULT", {
        normalizedQueryLength,
        generation,
        disposition: "malformed",
        rawCount: 0,
        mappedCount: 0,
        total: paging.total,
        hasMore: false,
        staleIgnored: false,
        reason: "malformed",
      });
      return {
        disposition: "malformed",
        rawCount: 0,
        mappedCount: 0,
        total: null,
        hasMore: false,
        nextCursor: null,
        rows: [],
        reason: "malformed",
        staleIgnored: false,
        generation,
        normalizedQueryLength,
      };
    }

    const mapped = parseSearchRows(res);
    const rawCount = parseChurchFeedListResponse(res).rows.length;

    console.log("KRISTO_HOME_FEED_SEARCH_RESULT", {
      normalizedQueryLength,
      generation,
      disposition: "network",
      rawCount,
      mappedCount: mapped.length,
      total: paging.total,
      hasMore: paging.hasMore,
      staleIgnored: false,
      reason: "ok",
    });
    console.log("KRISTO_HOME_FEED_SEARCH_DECISION", {
      normalizedQueryLength,
      generation,
      disposition: "network",
      staleIgnored: false,
      reason: "accept",
      rawCount,
      mappedCount: mapped.length,
      total: paging.total,
      hasMore: paging.hasMore,
    });

    return {
      disposition: "network",
      rawCount,
      mappedCount: mapped.length,
      total: paging.total,
      hasMore: paging.hasMore,
      nextCursor: paging.nextCursor,
      rows: mapped,
      reason: "ok",
      staleIgnored: false,
      generation,
      normalizedQueryLength,
    };
  } catch {
    if (!args.isCurrentGeneration(generation)) {
      return {
        disposition: "stale-cancelled",
        rawCount: 0,
        mappedCount: 0,
        total: null,
        hasMore: false,
        nextCursor: null,
        rows: [],
        reason: "stale-on-error",
        staleIgnored: true,
        generation,
        normalizedQueryLength,
      };
    }
    console.log("KRISTO_HOME_FEED_SEARCH_RESULT", {
      normalizedQueryLength,
      generation,
      disposition: "failed",
      rawCount: 0,
      mappedCount: 0,
      total: null,
      hasMore: false,
      staleIgnored: false,
      reason: "exception",
    });
    return {
      disposition: "failed",
      rawCount: 0,
      mappedCount: 0,
      total: null,
      hasMore: false,
      nextCursor: null,
      rows: [],
      reason: "exception",
      staleIgnored: false,
      generation,
      normalizedQueryLength,
    };
  }
}
