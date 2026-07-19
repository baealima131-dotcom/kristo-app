/**
 * Authoritative Home Feed pagination decisions.
 * Non-network / uncertain dispositions must never persist exhaustion.
 */

export type HomeFeedPagingState = {
  hasMore: boolean;
  nextCursor: string | null;
};

export type HomeFeedRequestDisposition =
  | "network"
  | "throttle-replay"
  | "dedupe-join"
  | "skipped"
  | "stale-cancelled"
  | "failed"
  | "malformed"
  | "empty-uncertain";

export type HomeFeedPagingDecisionAction = "accept" | "preserve" | "repair";

export type HomeFeedPagingDecision = {
  action: HomeFeedPagingDecisionAction;
  paging: HomeFeedPagingState;
  reason: string;
  disposition: HomeFeedRequestDisposition;
  responseHasMore: boolean | null;
  responseNextCursor: string | null;
  responseTotal: number | null;
  prior: HomeFeedPagingState;
};

const AUTHORITATIVE_DISPOSITIONS = new Set<HomeFeedRequestDisposition>(["network"]);

export function isAuthoritativeFeedPageResponse(res: unknown): boolean {
  if (!res || typeof res !== "object") return false;
  const body = res as Record<string, unknown>;
  if (body.ok === false) return false;
  if (body.ok === true) return true;
  const data = body.data;
  const hasData =
    Array.isArray(data) ||
    Array.isArray(body.items) ||
    (data != null &&
      typeof data === "object" &&
      Array.isArray((data as { items?: unknown }).items));
  return hasData && typeof body.hasMore === "boolean";
}

export function classifyFeedApiResponse(
  res: unknown,
  opts?: { throttleMs?: number; assumedDisposition?: HomeFeedRequestDisposition }
): HomeFeedRequestDisposition {
  if (opts?.assumedDisposition) return opts.assumedDisposition;
  if (!res || typeof res !== "object") return "malformed";
  const body = res as Record<string, unknown>;
  if (body.ok === false) return "failed";
  if (!isAuthoritativeFeedPageResponse(res)) return "malformed";
  if ((opts?.throttleMs || 0) > 0) {
    // Throttled paths may replay a prior body; never treat as fresh network.
    return "throttle-replay";
  }
  return "network";
}

export function readFeedResponseTotal(res: unknown): number | null {
  if (!res || typeof res !== "object") return null;
  const total = Number((res as { total?: unknown }).total);
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.floor(total);
}

export function readFeedResponseHasMore(res: unknown): boolean | null {
  if (!res || typeof res !== "object") return null;
  const value = (res as { hasMore?: unknown }).hasMore;
  if (typeof value === "boolean") return value;
  return null;
}

export function readFeedResponseNextCursor(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const value = (res as { nextCursor?: unknown }).nextCursor;
  if (value == null) return null;
  return String(value);
}

export function shouldRevalidateStaleHomeFeedExhaustion(args: {
  loadedPages: number;
  loadedRows: number;
  firstPageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
}): boolean {
  return (
    args.loadedPages <= 1 &&
    args.loadedRows >= args.firstPageSize &&
    args.hasMore === false &&
    (args.nextCursor == null || String(args.nextCursor).trim() === "")
  );
}

/**
 * Decide whether to accept, repair, or preserve pagination after a feed page response.
 */
export function decideHomeFeedPagingState(args: {
  disposition: HomeFeedRequestDisposition;
  prior: HomeFeedPagingState;
  responseHasMore: boolean | null;
  responseNextCursor: string | null;
  responseTotal: number | null;
  rawRowCount: number;
  mappedRowCount: number;
  loadedRows: number;
}): HomeFeedPagingDecision {
  const {
    disposition,
    prior,
    responseHasMore,
    responseNextCursor,
    responseTotal,
    rawRowCount,
    mappedRowCount,
    loadedRows,
  } = args;

  const base = {
    disposition,
    responseHasMore,
    responseNextCursor,
    responseTotal,
    prior: { ...prior },
  };

  if (!AUTHORITATIVE_DISPOSITIONS.has(disposition)) {
    // Throttle/dedupe may safely promote hasMore:true, but must never persist exhaustion.
    if (
      (disposition === "throttle-replay" || disposition === "dedupe-join") &&
      responseHasMore === true
    ) {
      const nextCursor =
        responseNextCursor != null && String(responseNextCursor).trim()
          ? String(responseNextCursor)
          : String(Math.max(loadedRows, mappedRowCount, rawRowCount));
      return {
        ...base,
        action: "accept",
        paging: { hasMore: true, nextCursor },
        reason: `non-authoritative-promote-hasMore:${disposition}`,
      };
    }
    return {
      ...base,
      action: "preserve",
      paging: { ...prior },
      reason: `non-authoritative:${disposition}`,
    };
  }

  if (responseHasMore == null) {
    return {
      ...base,
      action: "preserve",
      paging: { ...prior },
      reason: "malformed-missing-hasMore",
    };
  }

  // Authoritative total wins over a false hasMore.
  if (
    responseTotal != null &&
    responseTotal > loadedRows &&
    responseHasMore === false
  ) {
    const repairedCursor =
      responseNextCursor != null && String(responseNextCursor).trim()
        ? String(responseNextCursor)
        : String(loadedRows);
    return {
      ...base,
      action: "repair",
      paging: { hasMore: true, nextCursor: repairedCursor },
      reason: "total-gt-loadedRows",
    };
  }

  if (responseHasMore === true) {
    const nextCursor =
      responseNextCursor != null && String(responseNextCursor).trim()
        ? String(responseNextCursor)
        : String(Math.max(loadedRows, mappedRowCount, rawRowCount));
    return {
      ...base,
      action: "accept",
      paging: { hasMore: true, nextCursor },
      reason: "authoritative-hasMore-true",
    };
  }

  // Authoritative hasMore:false — accept real exhaustion (including empty page-2).
  return {
    ...base,
    action: "accept",
    paging: { hasMore: false, nextCursor: null },
    reason:
      mappedRowCount > 0 || rawRowCount > 0
        ? "authoritative-exhausted-with-rows"
        : "authoritative-exhausted-empty",
  };
}

export function logHomeFeedPagingStateDecision(
  decision: HomeFeedPagingDecision,
  extra?: Record<string, unknown>
): void {
  console.log("KRISTO_HOME_FEED_PAGING_STATE_DECISION", {
    action: decision.action,
    reason: decision.reason,
    disposition: decision.disposition,
    requestedCursor: extra?.requestedCursor ?? null,
    rawRowCount: extra?.rawRowCount ?? null,
    mappedRowCount: extra?.mappedRowCount ?? null,
    responseHasMore: decision.responseHasMore,
    responseNextCursor: decision.responseNextCursor,
    responseTotal: decision.responseTotal,
    priorHasMore: decision.prior.hasMore,
    priorNextCursor: decision.prior.nextCursor,
    resultHasMore: decision.paging.hasMore,
    resultNextCursor: decision.paging.nextCursor,
    ...extra,
  });
}
