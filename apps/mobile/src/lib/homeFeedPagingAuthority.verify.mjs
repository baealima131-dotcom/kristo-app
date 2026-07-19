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
  assert.match(apiSrc, /peekLastYoutubeMediaCollectMeta/);
  assert.match(screenSrc, /runHomeFeedStalePagingRevalidate/);
  assert.match(screenSrc, /pagingApplied/);
  assert.match(screenSrc, /post-cold-start/);
  assert.match(screenSrc, /KRISTO_HOME_FEED_PAGING_REVALIDATE_ELIGIBILITY/);
  assert.match(screenSrc, /coldStartAuthoritative/);
  assert.match(screenSrc, /await restoreYoutubeStreamRows\(merged, \{ coldStart: true \}\)/);
  assert.match(screenSrc, /runHomeFeedStalePagingRevalidateRef\.current\("post-cold-start"/);
  assert.match(apiSrc, /KRISTO_HOME_FEED_PAGING_REVALIDATE_START/);
  assert.match(apiSrc, /KRISTO_HOME_FEED_PAGING_REVALIDATE_RESULT/);
  assert.match(src, /KRISTO_HOME_FEED_PAGING_STATE_DECISION/);
  assert.match(apiSrc, /logHomeFeedPagingStateDecision/);
  // Watch queue file must remain untouched by this fix surface.
  assert.doesNotMatch(watchSrc, /revalidateHomeFeedYoutubeStaleExhaustion/);
  assert.doesNotMatch(watchSrc, /homeFeedPagingAuthority/);
  assert.doesNotMatch(watchSrc, /post-cold-start/);
  console.log("✓ source contracts");
}

/**
 * Simulates Home Feed cold-start revalidate wiring (no RN).
 * Mirrors guard ordering in HomeFeedScreen.runHomeFeedStalePagingRevalidate.
 */
function createStaleRevalidateWiring() {
  const state = {
    youtubeLayout: true,
    settled: false,
    attemptedThisFocus: false,
    inflight: false,
    focused: true,
    generation: 1,
    loadedPages: 1,
    loadedRows: 20,
    hasMore: true,
    nextCursor: null,
    probeStarts: 0,
    probeResults: [],
  };

  function eligibility(trigger, opts = {}) {
    const eligible = shouldRevalidateStaleHomeFeedExhaustion({
      loadedPages: state.loadedPages,
      loadedRows: state.loadedRows,
      firstPageSize: 20,
      hasMore: state.hasMore,
      nextCursor: state.nextCursor,
    });
    const coldStartAuthoritative =
      opts.coldStartAuthoritative === undefined ? null : opts.coldStartAuthoritative;

    if (!state.youtubeLayout) {
      return { eligible: false, reason: "not-youtube-layout", attemptStarted: false };
    }
    if (state.settled) {
      return { eligible: false, reason: "already-settled", attemptStarted: false };
    }
    if (state.attemptedThisFocus) {
      return { eligible: false, reason: "already-attempted-this-focus", attemptStarted: false };
    }
    if (state.inflight) {
      return { eligible: false, reason: "inflight", attemptStarted: false };
    }
    if (trigger === "post-cold-start" && coldStartAuthoritative === false) {
      return { eligible, reason: "cold-start-not-authoritative", attemptStarted: false };
    }
    if (!state.focused && trigger !== "mount") {
      return { eligible: false, reason: "blurred", attemptStarted: false };
    }
    if (!eligible) {
      return { eligible: false, reason: "not-eligible", attemptStarted: false };
    }
    return { eligible: true, reason: "eligible", attemptStarted: true };
  }

  function run(trigger, opts = {}, probeOutcome = "exhausted") {
    const genAtStart = state.generation;
    const gate = eligibility(trigger, opts);
    if (!gate.attemptStarted) return gate;

    state.attemptedThisFocus = true;
    state.inflight = true;
    state.probeStarts += 1;

    // blur/unmount cancel
    if (opts.cancelAfterStart) {
      state.focused = false;
      state.generation += 1;
      state.inflight = false;
      state.attemptedThisFocus = false;
      return { eligible: true, reason: "cancelled-after-await", attemptStarted: true, attemptSettled: false };
    }
    if (genAtStart !== state.generation || !state.focused) {
      state.inflight = false;
      state.attemptedThisFocus = false;
      return { eligible: true, reason: "cancelled-after-await", attemptStarted: true, attemptSettled: false };
    }

    if (probeOutcome === "preserve") {
      state.inflight = false;
      state.attemptedThisFocus = false;
      state.probeResults.push(probeOutcome);
      return { eligible: true, reason: "preserved", attemptStarted: true, attemptSettled: false };
    }

    state.settled = true;
    state.inflight = false;
    if (probeOutcome === "repair") {
      state.hasMore = true;
      state.nextCursor = "20";
    } else {
      state.hasMore = false;
      state.nextCursor = null;
    }
    state.probeResults.push(probeOutcome);
    return {
      eligible: true,
      reason: probeOutcome === "repair" ? "settled-repaired" : "settled-exhausted",
      attemptStarted: true,
      attemptSettled: true,
    };
  }

  function applyColdStart(paging, { authoritative }) {
    // cold-start force path clears once-per-focus guards (matches loadFeed).
    state.settled = false;
    state.attemptedThisFocus = false;
    state.hasMore = paging.hasMore;
    state.nextCursor = paging.nextCursor;
    state.loadedPages = 1;
    state.loadedRows = 20;
    return run("post-cold-start", { coldStartAuthoritative: authoritative });
  }

  return { state, eligibility, run, applyColdStart };
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

function testColdStartWiringMountSkipsTemporaryHasMoreTrue() {
  const wiring = createStaleRevalidateWiring();
  // Mount sees temporary hasMore:true (session create before cold-start settle).
  wiring.state.hasMore = true;
  wiring.state.nextCursor = null;
  const mount = wiring.run("mount");
  assert.equal(mount.reason, "not-eligible");
  assert.equal(mount.attemptStarted, false);
  assert.equal(wiring.state.probeStarts, 0);
  console.log("✓ mount skips while temporary hasMore:true");
}

function testColdStartWiringPostColdStartProbeOnce() {
  const wiring = createStaleRevalidateWiring();
  wiring.state.hasMore = true;
  assert.equal(wiring.run("mount").attemptStarted, false);

  // Cold-start settles one-page exhausted authoritatively → probe runs once.
  const post = wiring.applyColdStart(
    { hasMore: false, nextCursor: null },
    { authoritative: true }
  );
  assert.equal(post.reason, "settled-exhausted");
  assert.equal(post.attemptStarted, true);
  assert.equal(wiring.state.probeStarts, 1);

  // Second post-cold-start / focus must not start another probe.
  const again = wiring.run("post-cold-start", { coldStartAuthoritative: true });
  assert.equal(again.reason, "already-settled");
  assert.equal(wiring.state.probeStarts, 1);
  console.log("✓ post-cold-start probe runs exactly once");
}

function testColdStartWiringTrueExhaustionAndRepair() {
  const exhausted = createStaleRevalidateWiring();
  exhausted.state.hasMore = false;
  const trueExhaust = exhausted.applyColdStart(
    { hasMore: false, nextCursor: null },
    { authoritative: true }
  );
  assert.equal(trueExhaust.reason, "settled-exhausted");
  assert.equal(exhausted.state.hasMore, false);

  const repairWiring = createStaleRevalidateWiring();
  repairWiring.state.hasMore = false;
  const repaired = repairWiring.run(
    "post-cold-start",
    { coldStartAuthoritative: true },
    "repair"
  );
  assert.equal(repaired.reason, "settled-repaired");
  assert.equal(repairWiring.state.hasMore, true);
  assert.equal(repairWiring.state.nextCursor, "20");
  console.log("✓ true exhaustion settles; page2 repair clears exhausted");
}

function testColdStartWiringFailedColdStartDoesNotProbe() {
  const wiring = createStaleRevalidateWiring();
  wiring.state.hasMore = true;
  const failed = wiring.applyColdStart(
    { hasMore: true, nextCursor: null },
    { authoritative: false }
  );
  assert.equal(failed.reason, "cold-start-not-authoritative");
  assert.equal(failed.attemptStarted, false);
  assert.equal(wiring.state.probeStarts, 0);

  // Even if prior disk exhaustion is present, non-authoritative cold-start must not probe.
  wiring.state.hasMore = false;
  wiring.state.nextCursor = null;
  const skipped = wiring.run("post-cold-start", { coldStartAuthoritative: false });
  assert.equal(skipped.reason, "cold-start-not-authoritative");
  assert.equal(wiring.state.probeStarts, 0);
  console.log("✓ failed/non-authoritative cold-start does not trigger probe");
}

function testColdStartWiringBlurCancelsSafely() {
  const wiring = createStaleRevalidateWiring();
  wiring.state.hasMore = false;
  const cancelled = wiring.run(
    "post-cold-start",
    { coldStartAuthoritative: true, cancelAfterStart: true },
    "exhausted"
  );
  assert.equal(cancelled.reason, "cancelled-after-await");
  assert.equal(cancelled.attemptSettled, false);
  assert.equal(wiring.state.settled, false);
  assert.equal(wiring.state.attemptedThisFocus, false);
  console.log("✓ blur/unmount cancels follow-up safely");
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
  testColdStartWiringMountSkipsTemporaryHasMoreTrue();
  testColdStartWiringPostColdStartProbeOnce();
  testColdStartWiringTrueExhaustionAndRepair();
  testColdStartWiringFailedColdStartDoesNotProbe();
  testColdStartWiringBlurCancelsSafely();
  console.log("\nAll Home Feed paging authority checks passed.");
}

main();
