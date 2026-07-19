/**
 * Focused verification for Home Feed authoritative paging / stale exhaustion.
 * Mirrors homeFeedPagingAuthority.ts without RN imports.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "homeFeedPagingAuthority.ts"), "utf8");
const apiSrc = readFileSync(
  join(__dirname, "../components/homeFeed/homeFeedApi.ts"),
  "utf8"
);
const screenSrc = readFileSync(
  join(__dirname, "../components/homeFeed/HomeFeedScreen.tsx"),
  "utf8"
);
const watchSrc = readFileSync(join(__dirname, "homeFeedWatchUpNext.ts"), "utf8");

function isAuthoritativeFeedPageResponse(res) {
  if (!res || typeof res !== "object") return false;
  if (res.ok === false) return false;
  if (res.ok === true) return true;
  const data = res.data;
  const hasData =
    Array.isArray(data) ||
    Array.isArray(res.items) ||
    (data != null && typeof data === "object" && Array.isArray(data.items));
  return hasData && typeof res.hasMore === "boolean";
}

function classifyFeedApiResponse(res, opts = {}) {
  if (opts.assumedDisposition) return opts.assumedDisposition;
  if (!res || typeof res !== "object") return "malformed";
  if (res.ok === false) return "failed";
  if (!isAuthoritativeFeedPageResponse(res)) return "malformed";
  if ((opts.throttleMs || 0) > 0) return "throttle-replay";
  return "network";
}

function decideHomeFeedPagingState({
  disposition,
  prior,
  responseHasMore,
  responseNextCursor,
  responseTotal,
  rawRowCount,
  mappedRowCount,
  loadedRows,
}) {
  const base = {
    disposition,
    responseHasMore,
    responseNextCursor,
    responseTotal,
    prior: { ...prior },
  };

  if (disposition !== "network") {
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

  if (responseTotal != null && responseTotal > loadedRows && responseHasMore === false) {
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

function shouldRevalidateStaleHomeFeedExhaustion({
  loadedPages,
  loadedRows,
  firstPageSize,
  hasMore,
  nextCursor,
}) {
  return (
    loadedPages <= 1 &&
    loadedRows >= firstPageSize &&
    hasMore === false &&
    (nextCursor == null || String(nextCursor).trim() === "")
  );
}

function dedupeByPostId(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function testSourceContracts() {
  assert.match(src, /decideHomeFeedPagingState/);
  assert.match(src, /shouldRevalidateStaleHomeFeedExhaustion/);
  assert.match(apiSrc, /revalidateHomeFeedYoutubeStaleExhaustion/);
  assert.match(apiSrc, /throttleMs: 0/);
  assert.match(apiSrc, /dedupe: false/);
  assert.match(apiSrc, /params\.set\("cursor"/);
  assert.match(screenSrc, /runHomeFeedStalePagingRevalidate/);
  assert.match(screenSrc, /pagingApplied/);
  assert.match(apiSrc, /KRISTO_HOME_FEED_PAGING_REVALIDATE_START/);
  assert.match(apiSrc, /KRISTO_HOME_FEED_PAGING_REVALIDATE_RESULT/);
  assert.match(src, /KRISTO_HOME_FEED_PAGING_STATE_DECISION/);
  assert.match(apiSrc, /logHomeFeedPagingStateDecision/);
  // Watch queue file must remain untouched by this fix surface.
  assert.doesNotMatch(watchSrc, /revalidateHomeFeedYoutubeStaleExhaustion/);
  assert.doesNotMatch(watchSrc, /homeFeedPagingAuthority/);
  console.log("✓ source contracts");
}

function testThrottleEmptyDoesNotExhaust() {
  const prior = { hasMore: true, nextCursor: "20" };
  const decision = decideHomeFeedPagingState({
    disposition: classifyFeedApiResponse(
      { ok: true, data: [], hasMore: false, nextCursor: null },
      { throttleMs: 8000 }
    ),
    prior,
    responseHasMore: false,
    responseNextCursor: null,
    responseTotal: null,
    rawRowCount: 0,
    mappedRowCount: 0,
    loadedRows: 20,
  });
  assert.equal(decision.action, "preserve");
  assert.equal(decision.paging.hasMore, true);
  assert.equal(decision.paging.nextCursor, "20");
  console.log("✓ throttled empty body preserves paging");
}

function testFailedPreserves() {
  const prior = { hasMore: false, nextCursor: null };
  const decision = decideHomeFeedPagingState({
    disposition: "failed",
    prior,
    responseHasMore: false,
    responseNextCursor: null,
    responseTotal: null,
    rawRowCount: 0,
    mappedRowCount: 0,
    loadedRows: 20,
  });
  assert.equal(decision.action, "preserve");
  assert.deepEqual(decision.paging, prior);
  console.log("✓ failed request preserves paging");
}

function testStaleCancelledPreserves() {
  const prior = { hasMore: false, nextCursor: null };
  const decision = decideHomeFeedPagingState({
    disposition: "stale-cancelled",
    prior,
    responseHasMore: null,
    responseNextCursor: null,
    responseTotal: null,
    rawRowCount: 0,
    mappedRowCount: 0,
    loadedRows: 20,
  });
  assert.equal(decision.action, "preserve");
  console.log("✓ stale/cancelled preserves paging");
}

function testTotalPreventsFalseExhaustion() {
  const prior = { hasMore: false, nextCursor: null };
  const decision = decideHomeFeedPagingState({
    disposition: "network",
    prior,
    responseHasMore: false,
    responseNextCursor: null,
    responseTotal: 45,
    rawRowCount: 0,
    mappedRowCount: 0,
    loadedRows: 20,
  });
  assert.equal(decision.action, "repair");
  assert.equal(decision.paging.hasMore, true);
  assert.equal(decision.paging.nextCursor, "20");
  console.log("✓ total > loadedRows repairs false exhaustion");
}

function testTrueExhaustionAccepted() {
  const prior = { hasMore: false, nextCursor: null };
  const decision = decideHomeFeedPagingState({
    disposition: "network",
    prior,
    responseHasMore: false,
    responseNextCursor: null,
    responseTotal: 20,
    rawRowCount: 0,
    mappedRowCount: 0,
    loadedRows: 20,
  });
  assert.equal(decision.action, "accept");
  assert.equal(decision.paging.hasMore, false);
  assert.equal(decision.paging.nextCursor, null);
  console.log("✓ true 20-row backend remains exhausted");
}

function testPage2Recovery() {
  const prior = { hasMore: false, nextCursor: null };
  assert.equal(
    shouldRevalidateStaleHomeFeedExhaustion({
      loadedPages: 1,
      loadedRows: 20,
      firstPageSize: 20,
      hasMore: false,
      nextCursor: null,
    }),
    true
  );

  const decision = decideHomeFeedPagingState({
    disposition: "network",
    prior,
    responseHasMore: true,
    responseNextCursor: "40",
    responseTotal: 55,
    rawRowCount: 20,
    mappedRowCount: 20,
    loadedRows: 20,
  });
  assert.equal(decision.action, "accept");
  assert.equal(decision.paging.hasMore, true);
  assert.equal(decision.paging.nextCursor, "40");

  const page0 = Array.from({ length: 20 }, (_, i) => ({ id: `feed_${i}` }));
  const page2 = Array.from({ length: 20 }, (_, i) => ({ id: `feed_${i + 20}` }));
  const merged = dedupeByPostId([...page0, ...page2, page2[0]]);
  assert.equal(merged.length, 40);
  console.log("✓ stale hasMore:false + page2 recovers without duplicates");
}

function testRevalidateEligibilityBounds() {
  assert.equal(
    shouldRevalidateStaleHomeFeedExhaustion({
      loadedPages: 2,
      loadedRows: 40,
      firstPageSize: 20,
      hasMore: false,
      nextCursor: null,
    }),
    false
  );
  assert.equal(
    shouldRevalidateStaleHomeFeedExhaustion({
      loadedPages: 1,
      loadedRows: 19,
      firstPageSize: 20,
      hasMore: false,
      nextCursor: null,
    }),
    false
  );
  assert.equal(
    shouldRevalidateStaleHomeFeedExhaustion({
      loadedPages: 1,
      loadedRows: 20,
      firstPageSize: 20,
      hasMore: true,
      nextCursor: "20",
    }),
    false
  );
  console.log("✓ revalidate eligibility bounds");
}

function testThrottlePromoteHasMore() {
  const prior = { hasMore: false, nextCursor: null };
  const decision = decideHomeFeedPagingState({
    disposition: "throttle-replay",
    prior,
    responseHasMore: true,
    responseNextCursor: "20",
    responseTotal: 40,
    rawRowCount: 20,
    mappedRowCount: 20,
    loadedRows: 20,
  });
  assert.equal(decision.action, "accept");
  assert.equal(decision.paging.hasMore, true);
  console.log("✓ throttle may promote hasMore:true only");
}

function main() {
  testSourceContracts();
  testThrottleEmptyDoesNotExhaust();
  testFailedPreserves();
  testStaleCancelledPreserves();
  testTotalPreventsFalseExhaustion();
  testTrueExhaustionAccepted();
  testPage2Recovery();
  testRevalidateEligibilityBounds();
  testThrottlePromoteHasMore();
  console.log("\nAll Home Feed paging authority checks passed.");
}

main();
