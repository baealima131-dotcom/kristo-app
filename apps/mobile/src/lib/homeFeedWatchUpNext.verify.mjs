/**
 * Focused + stress verification for Watch Up Next refill / ownership / probe behavior.
 * Mirrors the critical algorithms in homeFeedWatchUpNext.ts without RN imports.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "homeFeedWatchUpNext.ts"), "utf8");
const screenSrc = readFileSync(
  join(__dirname, "../components/homeFeed/HomeFeedScreen.tsx"),
  "utf8"
);
const watchScreenSrc = readFileSync(
  join(__dirname, "../components/homeFeed/HomeFeedWatchScreen.tsx"),
  "utf8"
);
const prioritySrc = readFileSync(
  join(__dirname, "homeFeedWatchPlaybackPriority.ts"),
  "utf8"
);

function isVideoPost(row) {
  return row?.mediaType === "video" && Boolean(row?.id);
}
function normalizePostId(item) {
  return String(item?.id || "").trim();
}

let watchSessionOrder = [];
let upNextGeneration = 0;

function resetWatchUpNextSession() {
  watchSessionOrder = [];
  upNextGeneration = 0;
}

function recordWatchSessionVideo(postId) {
  const id = normalizePostId({ id: postId });
  if (!id) return upNextGeneration;
  if (watchSessionOrder[0] === id) return upNextGeneration;
  watchSessionOrder = [id, ...watchSessionOrder.filter((e) => e !== id)].slice(0, 40);
  upNextGeneration += 1;
  return upNextGeneration;
}

function mergeWatchUpNextCandidateRows(...rowGroups) {
  const seen = new Set();
  const merged = [];
  for (const group of rowGroups) {
    for (const row of group || []) {
      if (!isVideoPost(row)) continue;
      const id = normalizePostId(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
  }
  return merged;
}

function buildWatchUpNextVideos({ currentItem, candidates, excludePostIds, limit = 20 }) {
  const currentId = normalizePostId(currentItem);
  const exclude = new Set([currentId, ...(excludePostIds ?? watchSessionOrder)].filter(Boolean));
  return (candidates || [])
    .filter((row) => isVideoPost(row) && !exclude.has(normalizePostId(row)))
    .slice(0, limit);
}

async function ensureWatchQueueDepth({
  currentItem,
  candidates,
  threshold = 5,
  targetDepth = 20,
  hasMore = true,
  loadedPageCount = Number.POSITIVE_INFINITY,
  allowStaleExhaustionProbe = false,
  onStaleExhaustionProbe,
  fetchNextPage,
}) {
  let mergedCandidates = mergeWatchUpNextCandidateRows(candidates || []);
  let refillRequested = false;
  let refillSource = "memory";
  let fetchedCount = 0;
  let dedupedCount = 0;
  let recycledCount = 0;
  let backendExhausted = hasMore === false;
  let pagesFetched = 0;
  let staleHasMoreProbeAttempted = false;

  const buildUnseen = (pool) =>
    buildWatchUpNextVideos({
      currentItem,
      candidates: pool,
      limit: targetDepth,
    });

  let items = buildUnseen(mergedCandidates);
  let unseenCount = items.length;

  if (
    backendExhausted &&
    items.length < targetDepth &&
    loadedPageCount <= 1 &&
    allowStaleExhaustionProbe === true &&
    typeof fetchNextPage === "function"
  ) {
    staleHasMoreProbeAttempted = true;
    backendExhausted = false;
    try {
      onStaleExhaustionProbe?.();
    } catch {}
    console.log("KRISTO_WATCH_QUEUE_STALE_HAS_MORE_PROBE", {
      queueSize: items.length,
      targetDepth,
      loadedPageCount,
    });
  }

  console.log("KRISTO_WATCH_QUEUE_DEPTH", {
    queueSize: items.length,
    threshold,
    targetDepth,
    staleHasMoreProbeAttempted,
    hasMore: hasMore !== false && !backendExhausted,
  });

  const refillFloor = staleHasMoreProbeAttempted ? targetDepth : threshold;

  while (
    items.length < refillFloor &&
    !backendExhausted &&
    typeof fetchNextPage === "function" &&
    pagesFetched < 4
  ) {
    refillRequested = true;
    console.log("KRISTO_WATCH_QUEUE_REFILL_REQUESTED", {
      queueSize: items.length,
      refillFloor,
      pagesFetched,
      staleHasMoreProbeAttempted,
    });

    const page = await fetchNextPage();
    pagesFetched += 1;

    if (!page) {
      refillSource = refillSource === "memory" ? "fetch-skipped" : refillSource;
      break;
    }

    refillSource = String(page.source || "feed-next-page").trim() || "feed-next-page";
    if (refillSource === "inflight-skip" || refillSource === "stale-skip") break;
    if (refillSource === "no-more") {
      backendExhausted = true;
      break;
    }

    const incoming = Array.isArray(page.rows) ? page.rows : [];
    fetchedCount += incoming.length;
    const before = mergedCandidates.length;
    mergedCandidates = mergeWatchUpNextCandidateRows(mergedCandidates, incoming);
    const added = mergedCandidates.length - before;
    dedupedCount += Math.max(0, incoming.length - added);

    console.log("KRISTO_WATCH_QUEUE_REFILL_PAGE", {
      refillSource,
      pagesFetched,
      fetchedCount: incoming.length,
      hasMore: page.hasMore === true,
      staleHasMoreProbeAttempted,
    });

    if (page.hasMore === true) backendExhausted = false;
    else backendExhausted = true;

    items = buildUnseen(mergedCandidates);
    unseenCount = items.length;

    if (added === 0 && backendExhausted) break;
    if (added === 0 && incoming.length === 0) break;
    if (items.length >= targetDepth) break;
  }

  if (items.length < threshold && backendExhausted) {
    const recentHardExclude = watchSessionOrder.slice(0, 8);
    const recycleExclude = Array.from(
      new Set([normalizePostId(currentItem), ...recentHardExclude].filter(Boolean))
    );
    const recycled = buildWatchUpNextVideos({
      currentItem,
      candidates: mergedCandidates,
      excludePostIds: recycleExclude,
      limit: targetDepth,
    });
    const sessionSet = new Set(watchSessionOrder);
    recycledCount = recycled.filter((row) => sessionSet.has(normalizePostId(row))).length;
    if (recycled.length > items.length) {
      items = recycled;
      refillSource =
        refillSource === "memory" || refillSource === "fetch-skipped"
          ? "recycle-session"
          : `${refillSource}+recycle`;
    }
    console.log("KRISTO_WATCH_QUEUE_RECYCLE", {
      unseenCount,
      recycledCount,
      finalQueueCount: items.length,
      backendExhausted,
    });
  }

  const result = {
    items: items.slice(0, 20),
    mergedCandidates,
    refillRequested,
    refillSource,
    fetchedCount,
    pagesFetched,
    dedupedCount,
    unseenCount,
    recycledCount,
    finalQueueCount: Math.min(items.length, 20),
    backendExhausted,
    staleHasMoreProbeAttempted,
  };

  console.log("KRISTO_WATCH_QUEUE_ENSURED", {
    queueSize: result.finalQueueCount,
    refillRequested: result.refillRequested,
    refillSource: result.refillSource,
    pagesFetched: result.pagesFetched,
    fetchedCount: result.fetchedCount,
    recycledCount: result.recycledCount,
    backendExhausted: result.backendExhausted,
    staleHasMoreProbeAttempted: result.staleHasMoreProbeAttempted,
  });

  return result;
}

function makeVideo(id, churchId = "CH-A") {
  return {
    id,
    mediaType: "video",
    churchId,
    videoUrl: `https://example.com/${id}.mp4`,
    createdAt: new Date().toISOString(),
  };
}

/** Minimal Watch ownership simulator mirroring the hardened lifecycle rules. */
function createWatchOwnershipSimulator() {
  let watchScreenOpen = false;
  let jobsPaused = false;
  const events = [];

  function pause(reason) {
    if (jobsPaused) return;
    jobsPaused = true;
    events.push({ type: "PAUSED_JOB", reason });
  }
  function resume(reason) {
    if (!jobsPaused) return;
    jobsPaused = false;
    events.push({ type: "RESUMED_JOB", reason });
  }

  return {
    events,
    isOpen: () => watchScreenOpen,
    jobsPaused: () => jobsPaused,
    notifyOpened(postId) {
      watchScreenOpen = true;
      pause("watch-screen-open");
      events.push({ type: "OPENED", postId, phase: "watch-screen-open" });
    },
    notifyClosed() {
      watchScreenOpen = false;
      resume("watch-screen-closed");
      events.push({ type: "CLOSED", reason: "watch-screen-closed" });
    },
    /** Simulate the React effects: visible lifecycle separate from postId hops. */
    onVisibleChange(visible, postId) {
      if (!visible) {
        this.notifyClosed();
        return;
      }
      this.notifyOpened(postId);
    },
    onPostIdHop(visible, postId) {
      if (!visible) return;
      this.notifyOpened(postId);
    },
    onUnmount() {
      this.notifyClosed();
    },
  };
}

function sourceContractChecks() {
  assert.match(src, /export async function ensureWatchQueueDepth/);
  assert.match(src, /KRISTO_WATCH_QUEUE_REFILL_REQUESTED/);
  assert.match(src, /KRISTO_WATCH_QUEUE_ENSURED/);
  assert.match(src, /KRISTO_WATCH_QUEUE_STALE_HAS_MORE_PROBE/);
  assert.match(src, /staleHasMoreProbeAttempted/);
  assert.match(src, /allowStaleExhaustionProbe/);
  assert.match(src, /loadedPageCount/);
  assert.match(src, /duplicateTap:\s*true/);
  assert.match(src, /WATCH_QUEUE_REFILL_THRESHOLD\s*=\s*5/);
  assert.match(src, /WATCH_QUEUE_TARGET_DEPTH\s*=\s*20/);
  assert.match(src, /WATCH_REFILL_MAX_PAGES\s*=\s*4/);
  assert.match(src, /items\.length < threshold && backendExhausted/);
  assert.match(src, /refillFloor/);

  assert.match(screenSrc, /ensureWatchQueueDepth\(/);
  assert.match(screenSrc, /fetchWatchQueueNextPage/);
  assert.match(screenSrc, /watchQueueHasMoreProbedRef/);
  assert.match(screenSrc, /watchQueueStaleProbeNetworkAllowedRef/);
  assert.match(screenSrc, /onStaleExhaustionProbe/);
  assert.match(screenSrc, /staleHasMoreProbe/);
  assert.match(screenSrc, /youtubeStreamExhaustedRef\.current = false/);
  assert.match(screenSrc, /generation === previousGeneration/);

  assert.match(watchScreenSrc, /close ONLY when invisible or unmounted/);
  assert.match(watchScreenSrc, /\[visible\]/);
  assert.doesNotMatch(
    watchScreenSrc,
    /return \(\) => notifyWatchScreenClosed\(\);\s*\}, \[visible, payload\?\.postId\]/
  );
  // Close effect depends only on visibility — not postId.
  assert.match(
    watchScreenSrc,
    /notifyWatchScreenClosed\(\);\s*\}\s*\}, \[visible\]/
  );

  assert.match(prioritySrc, /resumeBackgroundMediaJobs\("watch-screen-closed"\)/);
  assert.doesNotMatch(screenSrc, /resumeBackgroundMediaJobs\("watch-queue/);

  console.log("✓ source contract checks");
}

async function testDuplicateTapDoesNotBumpGeneration() {
  resetWatchUpNextSession();
  const g1 = recordWatchSessionVideo("a");
  const g2 = recordWatchSessionVideo("a");
  const g3 = recordWatchSessionVideo("a");
  assert.equal(g1, 1);
  assert.equal(g2, 1);
  assert.equal(g3, 1);
  assert.deepEqual(watchSessionOrder, ["a"]);
  console.log("✓ duplicate taps do not bump generation or watchedCount");
}

async function testDuplicateTapDoesNotConsumeQueue() {
  resetWatchUpNextSession();
  const rows = Array.from({ length: 12 }, (_, i) => makeVideo(`q${i}`));
  const current = rows[0];
  recordWatchSessionVideo(current.id);
  const before = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: rows,
    threshold: 5,
    targetDepth: 10,
    hasMore: false,
  });
  const genBefore = upNextGeneration;
  recordWatchSessionVideo(current.id);
  recordWatchSessionVideo(current.id);
  assert.equal(upNextGeneration, genBefore);
  const after = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: rows,
    threshold: 5,
    targetDepth: 10,
    hasMore: false,
  });
  assert.equal(after.finalQueueCount, before.finalQueueCount);
  console.log("✓ duplicate taps do not consume queue entries");
}

async function testStaleHasMoreProbeOnceThenNormalPagination() {
  resetWatchUpNextSession();
  const initial = Array.from({ length: 8 }, (_, i) => makeVideo(`stale-${i}`));
  const remote = Array.from({ length: 40 }, (_, i) => makeVideo(`remote-${i}`));
  let cursor = 0;
  let probed = false;
  let networkAllowed = false;
  let probeNetworkCalls = 0;
  let totalFetchCalls = 0;

  const current = initial[0];
  recordWatchSessionVideo(current.id);

  const ensured = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: initial,
    threshold: 5,
    targetDepth: 20,
    hasMore: false, // stale session exhaustion
    loadedPageCount: 1,
    allowStaleExhaustionProbe: !probed,
    onStaleExhaustionProbe: () => {
      probed = true;
      networkAllowed = true;
    },
    fetchNextPage: async () => {
      totalFetchCalls += 1;
      const isProbe = networkAllowed;
      if (!isProbe && cursor === 0) {
        return { rows: [], hasMore: false, source: "no-more" };
      }
      if (isProbe) {
        probeNetworkCalls += 1;
        networkAllowed = false;
        console.log("KRISTO_WATCH_QUEUE_FETCH_START", {
          staleHasMoreProbe: true,
          cursor,
        });
      } else {
        console.log("KRISTO_WATCH_QUEUE_FETCH_START", {
          staleHasMoreProbe: false,
          cursor,
        });
      }
      const rows = remote.slice(cursor, cursor + 10);
      cursor += rows.length;
      return {
        rows,
        hasMore: cursor < remote.length,
        source: "watch-queue-feed-page",
      };
    },
  });

  assert.equal(ensured.staleHasMoreProbeAttempted, true);
  assert.equal(probeNetworkCalls, 1);
  assert.ok(totalFetchCalls >= 1);
  assert.ok(ensured.fetchedCount >= 10);
  assert.equal(ensured.backendExhausted, false);
  assert.ok(ensured.finalQueueCount >= 5);
  assert.ok(!String(ensured.refillSource).includes("recycle"));

  // Second ensure in same session must NOT probe again.
  const again = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: ensured.mergedCandidates,
    threshold: 5,
    targetDepth: 20,
    hasMore: true,
    loadedPageCount: 2,
    allowStaleExhaustionProbe: !probed,
    onStaleExhaustionProbe: () => {
      probed = true;
      networkAllowed = true;
    },
    fetchNextPage: async () => {
      totalFetchCalls += 1;
      const rows = remote.slice(cursor, cursor + 10);
      cursor += rows.length;
      return {
        rows,
        hasMore: cursor < remote.length,
        source: "watch-queue-feed-page",
      };
    },
  });
  assert.equal(again.staleHasMoreProbeAttempted, false);
  assert.equal(probeNetworkCalls, 1);
  console.log("✓ stale hasMore probe runs once, then normal pagination continues");
}

async function testRecycleOnlyAfterTrueExhaustion() {
  resetWatchUpNextSession();
  const videos = Array.from({ length: 16 }, (_, i) => makeVideo(`w${i}`));
  for (const v of videos) recordWatchSessionVideo(v.id);
  const current = videos[videos.length - 1];
  let fetchCalls = 0;
  const ensured = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: videos,
    threshold: 5,
    targetDepth: 10,
    hasMore: false,
    loadedPageCount: 3, // not stale — multiple pages already loaded
    allowStaleExhaustionProbe: true,
    fetchNextPage: async () => {
      fetchCalls += 1;
      return { rows: [], hasMore: false, source: "no-more" };
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(ensured.staleHasMoreProbeAttempted, false);
  assert.ok(ensured.recycledCount > 0);
  assert.ok(ensured.finalQueueCount >= 5);
  console.log("✓ recycle only after true exhaustion (no false probe when pages>1)");
}

async function testOwnershipNoCloseOnVideoHop() {
  const watch = createWatchOwnershipSimulator();
  watch.onVisibleChange(true, "v0");
  assert.equal(watch.isOpen(), true);
  assert.equal(watch.jobsPaused(), true);

  for (let i = 1; i <= 55; i += 1) {
    // postId hop while still visible — must NOT close / resume jobs
    watch.onPostIdHop(true, `v${i}`);
    assert.equal(watch.isOpen(), true, `open after hop ${i}`);
    assert.equal(watch.jobsPaused(), true, `paused after hop ${i}`);
  }

  const midHopResumes = watch.events.filter(
    (e) => e.type === "RESUMED_JOB" && e.reason === "watch-screen-closed"
  );
  assert.equal(midHopResumes.length, 0, "no watch-screen-closed resume during hops");

  watch.onVisibleChange(false, "v55");
  assert.equal(watch.isOpen(), false);
  assert.equal(watch.jobsPaused(), false);
  const closes = watch.events.filter((e) => e.reason === "watch-screen-closed");
  assert.ok(closes.length >= 1);

  console.log("✓ ownership stays open across 55 video hops; close only when invisible");
}

async function testStressFiftyPlusTransitionsWithBackend() {
  resetWatchUpNextSession();
  const watch = createWatchOwnershipSimulator();
  watch.onVisibleChange(true, "seed");

  const initial = Array.from({ length: 20 }, (_, i) => makeVideo(`v${i}`));
  const remote = Array.from({ length: 80 }, (_, i) => makeVideo(`extra${i}`, i % 2 ? "CH-B" : "CH-A"));
  let cursor = 0;
  let hasMore = false; // simulate stale session flag at Watch open
  let loadedPageCount = 1;
  let probed = false;
  let networkAllowed = false;
  let probeAttempts = 0;
  let recycleBeforeExhausted = 0;
  const runtimeLogs = [];

  let current = initial[0];
  recordWatchSessionVideo(current.id);
  let pool = initial.slice();

  for (let step = 1; step <= 55; step += 1) {
    watch.onPostIdHop(true, current.id);

    const ensured = await ensureWatchQueueDepth({
      currentItem: current,
      candidates: pool,
      threshold: 5,
      targetDepth: 20,
      hasMore,
      loadedPageCount,
      allowStaleExhaustionProbe: !probed,
      onStaleExhaustionProbe: () => {
        probed = true;
        networkAllowed = true;
        probeAttempts += 1;
      },
      fetchNextPage: async () => {
        const staleProbe = networkAllowed && !hasMore;
        if (staleProbe) networkAllowed = false;
        if (!hasMore && !staleProbe) {
          return { rows: [], hasMore: false, source: "no-more" };
        }
        console.log("KRISTO_WATCH_QUEUE_FETCH_START", {
          step,
          staleHasMoreProbe: staleProbe,
          cursor,
          loadedPageCount,
        });
        runtimeLogs.push(`FETCH_START step=${step} probe=${staleProbe}`);
        if (cursor >= remote.length) {
          hasMore = false;
          return { rows: [], hasMore: false, source: "watch-queue-feed-page" };
        }
        const rows = remote.slice(cursor, cursor + 10);
        cursor += rows.length;
        hasMore = cursor < remote.length;
        loadedPageCount = Math.max(loadedPageCount, 1 + Math.ceil(cursor / 10));
        runtimeLogs.push(`REFILL_PAGE step=${step} rows=${rows.length} hasMore=${hasMore}`);
        return {
          rows,
          hasMore,
          source: "watch-queue-feed-page",
        };
      },
    });

    runtimeLogs.push(
      `ENSURED step=${step} depth=${ensured.finalQueueCount} src=${ensured.refillSource} exhausted=${ensured.backendExhausted} probe=${ensured.staleHasMoreProbeAttempted}`
    );

    if (String(ensured.refillSource).includes("recycle") && hasMore) {
      recycleBeforeExhausted += 1;
    }

    assert.ok(
      ensured.finalQueueCount > 0,
      `queue reached zero at step ${step} while navigating`
    );
    if (hasMore || cursor < remote.length) {
      assert.ok(
        ensured.finalQueueCount > 0,
        `queue empty while backend still has pages at step ${step}`
      );
    }

    pool = ensured.mergedCandidates;
    const next = ensured.items[0] || pool.find((row) => row.id !== current.id);
    assert.ok(next, `no next candidate at step ${step}`);
    current = next;
    recordWatchSessionVideo(current.id);

    assert.equal(watch.jobsPaused(), true, `jobs resumed mid-hop at step ${step}`);
  }

  assert.equal(probeAttempts, 1, `expected exactly 1 probe, got ${probeAttempts}`);
  assert.equal(recycleBeforeExhausted, 0, "recycle must not run while backend has more");

  const midHopCloses = watch.events.filter(
    (e) => e.type === "RESUMED_JOB" && e.reason === "watch-screen-closed"
  );
  assert.equal(midHopCloses.length, 0);

  watch.onVisibleChange(false, current.id);
  assert.equal(watch.jobsPaused(), false);

  console.log("\n--- stress runtime log sample ---");
  for (const line of runtimeLogs.filter((l) => l.includes("FETCH_START") || l.includes("REFILL_PAGE")).slice(0, 12)) {
    console.log(line);
  }
  console.log(`... (${runtimeLogs.length} ensured/fetch events total)`);
  console.log("✓ stress: 55 Up Next transitions, probe once, queue never zero while backend has pages");
}

async function testThresholdOnlyRefillsWhenShallow() {
  resetWatchUpNextSession();
  const current = makeVideo("deep-cur");
  recordWatchSessionVideo(current.id);
  const deep = [current, ...Array.from({ length: 12 }, (_, i) => makeVideo(`deep-${i}`))];
  let fetchCalls = 0;
  const ensured = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: deep,
    threshold: 5,
    targetDepth: 20,
    hasMore: true,
    fetchNextPage: async () => {
      fetchCalls += 1;
      return { rows: [makeVideo("should-not-fetch")], hasMore: true, source: "watch-queue-feed-page" };
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(ensured.refillRequested, false);
  assert.ok(ensured.finalQueueCount >= 5);
  console.log("✓ refill triggers only below threshold (when not probing)");
}

async function testInflightSkipDoesNotRecycleOrExhaust() {
  resetWatchUpNextSession();
  const current = makeVideo("cur");
  recordWatchSessionVideo(current.id);
  const pool = [current, makeVideo("only-a"), makeVideo("only-b")];
  let fetchCalls = 0;
  const ensured = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: pool,
    threshold: 5,
    targetDepth: 10,
    hasMore: true,
    fetchNextPage: async () => {
      fetchCalls += 1;
      return { rows: [], hasMore: true, source: "inflight-skip" };
    },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(ensured.backendExhausted, false);
  assert.equal(ensured.recycledCount, 0);
  assert.ok(ensured.finalQueueCount < 5);
  console.log("✓ inflight/transient skip does not mark exhausted or recycle");
}

async function main() {
  sourceContractChecks();
  await testDuplicateTapDoesNotBumpGeneration();
  await testDuplicateTapDoesNotConsumeQueue();
  await testThresholdOnlyRefillsWhenShallow();
  await testInflightSkipDoesNotRecycleOrExhaust();
  await testStaleHasMoreProbeOnceThenNormalPagination();
  await testRecycleOnlyAfterTrueExhaustion();
  await testOwnershipNoCloseOnVideoHop();
  await testStressFiftyPlusTransitionsWithBackend();
  console.log("\nAll Watch Up Next hardening verifications passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
