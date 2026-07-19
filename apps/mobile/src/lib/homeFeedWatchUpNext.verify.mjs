/**
 * Focused verification for Watch Up Next refill / session behavior.
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

function isVideoPost(row) {
  return row?.mediaType === "video" && Boolean(row?.id);
}
function normalizePostId(item) {
  return String(item?.id || "").trim();
}
function homeFeedRowChurchId(item) {
  return String(item?.churchId || "").trim();
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
  fetchNextPage,
}) {
  let mergedCandidates = mergeWatchUpNextCandidateRows(candidates || []);
  let refillRequested = false;
  let fetchedCount = 0;
  let dedupedCount = 0;
  let recycledCount = 0;
  let backendExhausted = hasMore === false;
  let pagesFetched = 0;
  let items = buildWatchUpNextVideos({
    currentItem,
    candidates: mergedCandidates,
    limit: targetDepth,
  });
  const unseenBeforeRecycle = () =>
    buildWatchUpNextVideos({
      currentItem,
      candidates: mergedCandidates,
      limit: targetDepth,
    });

  while (
    items.length < threshold &&
    !backendExhausted &&
    typeof fetchNextPage === "function" &&
    pagesFetched < 4
  ) {
    refillRequested = true;
    const page = await fetchNextPage();
    pagesFetched += 1;
    if (!page || page.source === "inflight-skip" || page.source === "stale-skip") break;
    if (page.source === "no-more") {
      backendExhausted = true;
      break;
    }
    const incoming = page.rows || [];
    fetchedCount += incoming.length;
    const before = mergedCandidates.length;
    mergedCandidates = mergeWatchUpNextCandidateRows(mergedCandidates, incoming);
    dedupedCount += Math.max(0, incoming.length - (mergedCandidates.length - before));
    if (page.hasMore !== true) backendExhausted = true;
    items = unseenBeforeRecycle();
    if (items.length >= targetDepth) break;
  }

  const unseenCount = unseenBeforeRecycle().length;
  if (items.length < threshold && backendExhausted) {
    const recent = watchSessionOrder.slice(0, 8);
    const recycled = buildWatchUpNextVideos({
      currentItem,
      candidates: mergedCandidates,
      excludePostIds: [normalizePostId(currentItem), ...recent],
      limit: targetDepth,
    });
    const sessionSet = new Set(watchSessionOrder);
    recycledCount = recycled.filter((row) => sessionSet.has(normalizePostId(row))).length;
    if (recycled.length > items.length) items = recycled;
  }

  return {
    items: items.slice(0, 20),
    mergedCandidates,
    refillRequested,
    fetchedCount,
    pagesFetched,
    dedupedCount,
    unseenCount,
    recycledCount,
    finalQueueCount: Math.min(items.length, 20),
    backendExhausted,
  };
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

function sourceContractChecks() {
  assert.match(src, /export async function ensureWatchQueueDepth/);
  assert.match(src, /KRISTO_WATCH_QUEUE_REFILL_REQUESTED/);
  assert.match(src, /KRISTO_WATCH_QUEUE_ENSURED/);
  assert.match(src, /duplicateTap:\s*true/);
  assert.match(src, /export function resetWatchUpNextSession/);
  assert.match(src, /WATCH_QUEUE_REFILL_THRESHOLD\s*=\s*5/);
  assert.match(src, /WATCH_QUEUE_TARGET_DEPTH\s*=\s*20/);
  assert.match(src, /WATCH_REFILL_MAX_PAGES\s*=\s*4/);
  assert.match(src, /items\.length < threshold && backendExhausted/);
  assert.match(src, /stale-skip/);
  assert.match(screenSrc, /ensureWatchQueueDepth\(/);
  assert.match(screenSrc, /fetchWatchQueueNextPage/);
  assert.match(screenSrc, /watchUpNextPoolRef/);
  assert.match(screenSrc, /watchQueueRequestIdRef/);
  assert.match(screenSrc, /resetWatchUpNextSession\(\)/);
  assert.match(screenSrc, /generation === previousGeneration/);
  assert.match(screenSrc, /source:\s*"watch-queue-feed-page"/);
  assert.match(screenSrc, /source:\s*"stale-skip"/);
  assert.match(screenSrc, /notifyWatchScreenOpened/);
  assert.doesNotMatch(
    screenSrc,
    /resumeBackgroundMediaJobs\("watch-queue/
  );
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

async function testQueueDoesNotShrinkToZeroWithBackend() {
  resetWatchUpNextSession();
  const initial = Array.from({ length: 20 }, (_, i) => makeVideo(`v${i}`));
  let cursor = 20;
  const remote = Array.from({ length: 40 }, (_, i) => makeVideo(`extra${i}`, i % 2 ? "CH-B" : "CH-A"));

  let current = initial[0];
  recordWatchSessionVideo(current.id);
  let pool = initial.slice();

  for (let step = 1; step <= 20; step += 1) {
    const ensured = await ensureWatchQueueDepth({
      currentItem: current,
      candidates: pool,
      threshold: 5,
      targetDepth: 20,
      hasMore: cursor < 20 + remote.length,
      fetchNextPage: async () => {
        if (cursor >= 20 + remote.length) {
          return { rows: [], hasMore: false, source: "no-more" };
        }
        const rows = remote.slice(cursor - 20, cursor - 20 + 10);
        cursor += 10;
        return {
          rows,
          hasMore: cursor < 20 + remote.length,
          source: "watch-queue-feed-page",
        };
      },
    });
    pool = ensured.mergedCandidates;
    assert.ok(
      ensured.finalQueueCount >= 5,
      `step ${step}: expected queue >= 5, got ${ensured.finalQueueCount}`
    );
    assert.ok(
      !ensured.items.some((row) => normalizePostId(row) === normalizePostId(current)),
      "current video must not appear in Up Next"
    );
    const next = ensured.items[0];
    assert.ok(next, `step ${step}: missing next item`);
    current = next;
    recordWatchSessionVideo(current.id);
  }
  console.log("✓ opening 20 successive videos keeps queue depth via refill");
}

async function testRefillPreservesCurrentAndDedupes() {
  resetWatchUpNextSession();
  const current = makeVideo("current");
  recordWatchSessionVideo(current.id);
  const pool = [current, makeVideo("a"), makeVideo("b")];
  const ensured = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: pool,
    threshold: 5,
    targetDepth: 10,
    hasMore: true,
    fetchNextPage: async () => ({
      rows: [makeVideo("a"), makeVideo("c"), makeVideo("d"), makeVideo("e"), makeVideo("f")],
      hasMore: false,
      source: "watch-queue-feed-page",
    }),
  });
  assert.equal(ensured.refillRequested, true);
  assert.ok(ensured.dedupedCount >= 1);
  assert.ok(!ensured.items.some((row) => row.id === "current"));
  assert.ok(ensured.finalQueueCount >= 5);
  console.log("✓ refill dedupes, preserves current exclusion, restores depth");
}

async function testWatchedNotImmediatelyRepeatedThenRecycle() {
  resetWatchUpNextSession();
  const videos = Array.from({ length: 16 }, (_, i) => makeVideo(`w${i}`));
  for (const v of videos) recordWatchSessionVideo(v.id);
  const current = videos[videos.length - 1];
  const ensured = await ensureWatchQueueDepth({
    currentItem: current,
    candidates: videos,
    threshold: 5,
    targetDepth: 10,
    hasMore: false,
    fetchNextPage: async () => ({ rows: [], hasMore: false, source: "no-more" }),
  });
  assert.ok(ensured.recycledCount > 0);
  assert.ok(ensured.finalQueueCount >= 5);
  assert.ok(!ensured.items.some((row) => row.id === current.id));
  // Most recent watched should be hard-excluded from immediate recycle.
  const recentIds = new Set(watchSessionOrder.slice(0, 8));
  for (const row of ensured.items) {
    assert.ok(
      !recentIds.has(row.id),
      `recent watched ${row.id} should not immediately repeat`
    );
  }
  console.log("✓ backend-empty recycle avoids current + recent watched");
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

async function testBoundedPageFetch() {
  resetWatchUpNextSession();
  const current = makeVideo("bound-cur");
  recordWatchSessionVideo(current.id);
  let fetchCalls = 0;
  await ensureWatchQueueDepth({
    currentItem: current,
    candidates: [current],
    threshold: 5,
    targetDepth: 20,
    hasMore: true,
    fetchNextPage: async () => {
      fetchCalls += 1;
      return {
        rows: [makeVideo(`page-${fetchCalls}-a`)],
        hasMore: true,
        source: "watch-queue-feed-page",
      };
    },
  });
  assert.ok(fetchCalls <= 4, `expected <=4 pages, got ${fetchCalls}`);
  console.log("✓ refill page fetch is bounded (<=4)");
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
  console.log("✓ refill triggers only below threshold");
}

async function main() {
  sourceContractChecks();
  await testDuplicateTapDoesNotBumpGeneration();
  await testDuplicateTapDoesNotConsumeQueue();
  await testThresholdOnlyRefillsWhenShallow();
  await testBoundedPageFetch();
  await testRefillPreservesCurrentAndDedupes();
  await testInflightSkipDoesNotRecycleOrExhaust();
  await testWatchedNotImmediatelyRepeatedThenRecycle();
  await testQueueDoesNotShrinkToZeroWithBackend();
  console.log("\nAll Watch Up Next verifications passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
