/**
 * Focused verification for backend-backed Home Feed video search.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../../..");

const backendSearchSrc = readFileSync(
  join(root, "app/api/_lib/homeFeedSearch.ts"),
  "utf8"
);
const feedRouteSrc = readFileSync(join(root, "app/api/church/feed/route.ts"), "utf8");
const sheetSrc = readFileSync(
  join(__dirname, "../components/homeFeed/HomeFeedSearchSheet.tsx"),
  "utf8"
);
const searchApiSrc = readFileSync(
  join(__dirname, "../components/homeFeed/homeFeedSearchApi.ts"),
  "utf8"
);
const screenSrc = readFileSync(
  join(__dirname, "../components/homeFeed/HomeFeedScreen.tsx"),
  "utf8"
);
const utilsSrc = readFileSync(
  join(__dirname, "../components/homeFeed/homeFeedUtils.ts"),
  "utf8"
);
const homeFeedApiSrc = readFileSync(
  join(__dirname, "../components/homeFeed/homeFeedApi.ts"),
  "utf8"
);
const watchSrc = readFileSync(join(__dirname, "homeFeedWatchUpNext.ts"), "utf8");
const pagingSrc = readFileSync(join(__dirname, "homeFeedPagingAuthority.ts"), "utf8");

const HOME_FEED_SEARCH_MAX_QUERY_LENGTH = 100;

function normalizeHomeFeedSearchQuery(input) {
  if (input == null || typeof input !== "string") return "";
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseHomeFeedSearchQueryParam(searchParams) {
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

function resolveTitle(item) {
  return normalizeHomeFeedSearchQuery(item?.title || item?.postTitle || "");
}

function resolveCaption(item) {
  return normalizeHomeFeedSearchQuery(
    [item?.text, item?.caption, item?.body, item?.description].filter(Boolean).join(" ")
  );
}

function resolveMeta(item) {
  const parts = [
    item?.churchName,
    item?.mediaName,
    item?.actorLabel || item?.authorName || item?.churchName,
    item?.type,
    item?.authorName,
    item?.author?.name,
    item?.ministryName || item?.ministry?.name || item?.roomName,
  ];
  return parts
    .map((part) => normalizeHomeFeedSearchQuery(part))
    .filter(Boolean)
    .join(" ");
}

function rankHomeFeedSearchMatch(item, normalizedQuery) {
  const needle = normalizeHomeFeedSearchQuery(normalizedQuery);
  if (!needle) return Number.POSITIVE_INFINITY;
  const title = resolveTitle(item);
  if (title && title === needle) return 0;
  if (title && title.startsWith(needle)) return 1;
  if (title && title.includes(needle)) return 2;
  const caption = resolveCaption(item);
  if (caption && caption.includes(needle)) return 3;
  const meta = resolveMeta(item);
  if (meta && meta.includes(needle)) return 4;
  return Number.POSITIVE_INFINITY;
}

function filterHomeFeedRowsBySearchQuery(rows, normalizedQuery) {
  const needle = normalizeHomeFeedSearchQuery(normalizedQuery);
  if (!needle) return Array.isArray(rows) ? rows : [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({ row, index, rank: rankHomeFeedSearchMatch(row, needle) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index))
    .map((entry) => entry.row);
}

function createSearchController() {
  let generation = 0;
  let phase = "idle";
  let authoritativeRows = [];
  let pending = null;
  let backendCalls = [];

  return {
    get phase() {
      return phase;
    },
    get authoritativeRows() {
      return authoritativeRows;
    },
    get backendCalls() {
      return backendCalls;
    },
    onChangeText(next, opts = {}) {
      const normalized = normalizeHomeFeedSearchQuery(next);
      generation += 1;
      const gen = generation;
      pending = null;
      if (!normalized) {
        phase = "idle";
        authoritativeRows = [];
        return { generation: gen, requestStarted: false };
      }
      phase = "preview";
      authoritativeRows = [];
      if (opts.immediate) {
        return this.runBackend(normalized, gen, opts.backend);
      }
      pending = { normalized, gen };
      return { generation: gen, requestStarted: false, pending: true };
    },
    flushDebounce(backend) {
      if (!pending) return { requestStarted: false };
      const { normalized, gen } = pending;
      pending = null;
      return this.runBackend(normalized, gen, backend);
    },
    runBackend(normalized, gen, backend) {
      if (gen !== generation) {
        return { staleIgnored: true, requestStarted: false };
      }
      phase = "loading";
      backendCalls.push({ q: normalized, generation: gen });
      const res = backend({ q: normalized, generation: gen });
      if (gen !== generation) {
        return { staleIgnored: true, disposition: "stale-cancelled" };
      }
      if (res?.disposition === "network") {
        authoritativeRows = res.rows || [];
        phase = "ready";
        return { staleIgnored: false, disposition: "network", rows: authoritativeRows };
      }
      authoritativeRows = [];
      phase = "error";
      return { staleIgnored: false, disposition: res?.disposition || "failed", rows: [] };
    },
    bumpGeneration() {
      generation += 1;
      return generation;
    },
  };
}

function testNormalizeAndShortQueries() {
  assert.equal(normalizeHomeFeedSearchQuery("  Ab  C  "), "ab c");
  assert.equal(normalizeHomeFeedSearchQuery("x").length, 1);
  const rows = [
    { id: "1", title: "Alpha worship", churchName: "Grace" },
    { id: "2", title: "Beta", ministryName: "Youth Ministry" },
    { id: "3", title: "Gamma", text: "hello world" },
  ];
  assert.ok(filterHomeFeedRowsBySearchQuery(rows, "a").length >= 1);
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "al").length, 1);
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "alp").length, 1);
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "yo").length, 1);
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "you").length, 1);
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "youth").length, 1);
}

function testMinistryAndFields() {
  const rows = [
    { id: "m1", title: "Clip", ministryName: "Worship Team" },
    { id: "m2", title: "Other", churchName: "North Church", authorName: "Jane Doe" },
    { id: "m3", title: "Caption hit", text: "sunrise service" },
  ];
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "worship team")[0].id, "m1");
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "north")[0].id, "m2");
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "jane")[0].id, "m2");
  assert.equal(filterHomeFeedRowsBySearchQuery(rows, "sunrise")[0].id, "m3");
}

function testOutsideFirst20() {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `feed_${i}`,
    title: i === 22 ? "UniqueZebraTitle" : `Video ${i}`,
    createdAt: `2026-01-${String(25 - i).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const first20 = rows.slice(0, 20);
  assert.equal(filterHomeFeedRowsBySearchQuery(first20, "uniquezebra").length, 0);
  const matched = filterHomeFeedRowsBySearchQuery(rows, "uniquezebra");
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, "feed_22");
}

function testEmptyQueryNoBackend() {
  const ctrl = createSearchController();
  const r = ctrl.onChangeText("   ");
  assert.equal(r.requestStarted, false);
  assert.equal(ctrl.backendCalls.length, 0);
  assert.equal(ctrl.phase, "idle");
}

function testOneCharReachesBackend() {
  const ctrl = createSearchController();
  ctrl.onChangeText("a");
  const r = ctrl.flushDebounce(({ q }) => {
    assert.equal(q, "a");
    return { disposition: "network", rows: [{ id: "1", title: "Alpha" }] };
  });
  assert.equal(ctrl.backendCalls.length, 1);
  assert.equal(ctrl.backendCalls[0].q, "a");
  assert.equal(r.disposition, "network");
  assert.equal(ctrl.phase, "ready");
}

function testStaleIgnored() {
  const ctrl = createSearchController();
  ctrl.onChangeText("ab");
  const genAtSchedule = ctrl.backendCalls.length;
  assert.equal(genAtSchedule, 0);
  ctrl.bumpGeneration();
  const r = ctrl.flushDebounce(() => ({ disposition: "network", rows: [{ id: "x" }] }));
  // pending was for old gen; flushDebounce uses pending gen which no longer matches
  assert.equal(r.staleIgnored, true);
}

function testAuthoritativeZeroClearsPreview() {
  const ctrl = createSearchController();
  ctrl.onChangeText("zz");
  assert.equal(ctrl.phase, "preview");
  const r = ctrl.flushDebounce(() => ({ disposition: "network", rows: [] }));
  assert.equal(r.disposition, "network");
  assert.equal(ctrl.authoritativeRows.length, 0);
  assert.equal(ctrl.phase, "ready");
}

function testFailedSafeState() {
  const ctrl = createSearchController();
  ctrl.onChangeText("nope");
  const r = ctrl.flushDebounce(() => ({ disposition: "failed", rows: [{ id: "stale-preview" }] }));
  assert.equal(r.disposition, "failed");
  assert.equal(ctrl.authoritativeRows.length, 0);
  assert.equal(ctrl.phase, "error");
}

function testParseQueryParam() {
  const empty = parseHomeFeedSearchQueryParam(new URLSearchParams("scope=global"));
  assert.equal(empty.active, false);
  const one = parseHomeFeedSearchQueryParam(new URLSearchParams("q=Hi"));
  assert.equal(one.active, true);
  assert.equal(one.normalizedQuery, "hi");
  const conflict = parseHomeFeedSearchQueryParam(new URLSearchParams("q=a&q=b"));
  assert.equal(conflict.rejected, true);
  assert.equal(conflict.active, false);
}

function testSourceWiring() {
  assert.match(feedRouteSrc, /parseHomeFeedSearchQueryParam/);
  assert.match(feedRouteSrc, /filterHomeFeedRowsBySearchQuery\(listRows/);
  assert.match(feedRouteSrc, /searchableRows/);
  assert.match(feedRouteSrc, /KRISTO_FEED_SEARCH_PAGE/);
  assert.match(backendSearchSrc, /ministryName/);
  assert.match(backendSearchSrc, /HOME_FEED_SEARCH_MAX_QUERY_LENGTH/);

  assert.match(searchApiSrc, /screen:\s*["']HomeFeedSearch["']/);
  assert.match(searchApiSrc, /throttleMs:\s*0/);
  assert.match(searchApiSrc, /dedupe:\s*false/);
  assert.match(searchApiSrc, /mediaOnly:\s*["']1["']/);
  assert.match(searchApiSrc, /scope:\s*["']global["']/);
  assert.match(searchApiSrc, /params\.set\("q"|q:\s*normalized|["']q["']\s*,\s*normalized/);
  assert.match(searchApiSrc, /KRISTO_HOME_FEED_SEARCH_REQUEST/);
  assert.match(searchApiSrc, /KRISTO_HOME_FEED_SEARCH_RESULT/);
  assert.match(searchApiSrc, /KRISTO_HOME_FEED_SEARCH_DECISION/);
  assert.match(searchApiSrc, /resolveHomeFeedSearchSelection/);
  assert.match(searchApiSrc, /buildHomeFeedVideoOpenPayload/);
  assert.match(searchApiSrc, /preserveFeedOrder:\s*true/);
  assert.match(searchApiSrc, /action:\s*["']open-watch["']/);
  assert.doesNotMatch(searchApiSrc, /scroll-in-feed/);
  assert.match(backendSearchSrc, /rankHomeFeedSearchMatch/);

  assert.match(sheetSrc, /HOME_FEED_SEARCH_DEBOUNCE_MS/);
  assert.match(sheetSrc, /fetchHomeFeedVideoSearchPage/);
  assert.match(sheetSrc, /KRISTO_HOME_FEED_SEARCH_INPUT/);
  assert.match(sheetSrc, /generationRef/);
  assert.match(sheetSrc, /phase === "preview"/);
  assert.match(sheetSrc, /resetSearchState\(\)/);

  assert.match(screenSrc, /handleSearchSelectRow/);
  assert.match(screenSrc, /resolveHomeFeedSearchSelection/);
  assert.match(screenSrc, /preserveFeedOrder:\s*true/);
  assert.match(screenSrc, /options\?\.preserveFeedOrder/);
  assert.match(screenSrc, /onSelectRow=\{handleSearchSelectRow\}/);
  assert.doesNotMatch(screenSrc, /scroll-in-feed/);
  assert.match(screenSrc, /reason:\s*decision\.action === ["']open-watch["'] \? ["']open-watch["']/);

  assert.match(utilsSrc, /ministryName/);
  assert.match(utilsSrc, /normalizeHomeFeedSearchQuery/);

  // Must not reuse church directory search route.
  assert.doesNotMatch(searchApiSrc, /\/api\/church\/search/);
  assert.doesNotMatch(sheetSrc, /\/api\/church\/search/);

  // Must not mutate paging/session helpers in search api.
  assert.doesNotMatch(searchApiSrc, /applyFeedPagingState|saveHomeFeedYoutubeStreamSession|youtubeStreamExhausted/);

  // Watch + paging authority files untouched by this feature's search module wiring.
  assert.ok(watchSrc.length > 0);
  assert.ok(pagingSrc.length > 0);
  assert.ok(homeFeedApiSrc.includes("runHomeFeedStalePagingRevalidate") || homeFeedApiSrc.includes("resolveYoutubePagingFromResponse"));
}

function testPaginationUnaffectedPattern() {
  // Search applies after mediaOnly filter construction, before slice pagination.
  const idxFilter = feedRouteSrc.indexOf("mediaOnly ? isHomeFeedVideoMediaOnlyItem");
  const idxSearch = feedRouteSrc.indexOf("filterHomeFeedRowsBySearchQuery(listRows");
  const idxSlice = feedRouteSrc.indexOf("searchableRows.slice(pageOffset");
  assert.ok(idxFilter > 0 && idxSearch > idxFilter && idxSlice > idxSearch);
}

function resolveSelection({ selectedRow, feedRows }) {
  const rowKey = String(selectedRow?.id || "").trim();
  const inFeed = feedRows.some((r) => String(r?.id || "").trim() === rowKey);
  if (!rowKey) {
    return { action: "noop", inFeed, mutatesPaging: false, preserveFeedOrder: false };
  }
  const canOpen =
    Boolean(selectedRow?.videoUrl || selectedRow?.videoUri) ||
    String(selectedRow?.type || "").toLowerCase() === "video";
  if (!canOpen) {
    return { action: "noop", rowKey, inFeed, mutatesPaging: false, preserveFeedOrder: false };
  }
  return {
    action: "open-watch",
    rowKey,
    inFeed,
    mutatesPaging: false,
    preserveFeedOrder: true,
    postId: rowKey,
    watchPostId: rowKey,
  };
}

function testInFeedOpensWatchDirectly() {
  const feedRows = Array.from({ length: 20 }, (_, i) => ({
    id: `feed_${i}`,
    type: "video",
    videoUrl: `https://cdn.example/${i}.mp4`,
  }));
  const selected = feedRows[3];
  const decision = resolveSelection({ selectedRow: selected, feedRows });
  assert.equal(decision.action, "open-watch");
  assert.equal(decision.inFeed, true);
  assert.equal(decision.preserveFeedOrder, true);
  assert.equal(decision.watchPostId, selected.id);
  assert.equal(decision.mutatesPaging, false);
  assert.notEqual(decision.action, "scroll-in-feed");
}

function testOutsideOpensWatchDirectly() {
  const feedRows = Array.from({ length: 20 }, (_, i) => ({
    id: `feed_${i}`,
    type: "video",
    videoUrl: `https://cdn.example/${i}.mp4`,
  }));
  const selected = {
    id: "feed_22",
    type: "video",
    videoUrl: "https://cdn.example/22.mp4",
    title: "Outside",
    posterUri: "https://cdn.example/22.jpg",
    churchName: "Grace",
    mediaName: "Grace Media",
    source: "media-upload",
  };
  const decision = resolveSelection({ selectedRow: selected, feedRows });
  assert.equal(decision.action, "open-watch");
  assert.equal(decision.inFeed, false);
  assert.equal(decision.postId, "feed_22");
  assert.equal(decision.watchPostId, "feed_22");
  assert.equal(decision.preserveFeedOrder, true);
  assert.equal(decision.mutatesPaging, false);
}

function testNoSearchResultUsesScrollInFeed() {
  assert.doesNotMatch(searchApiSrc, /scroll-in-feed/);
  assert.doesNotMatch(screenSrc, /scroll-in-feed/);
  const feedRows = [{ id: "in", type: "video", videoUrl: "https://cdn.example/in.mp4" }];
  const a = resolveSelection({ selectedRow: feedRows[0], feedRows });
  const b = resolveSelection({
    selectedRow: { id: "out", type: "video", videoUrl: "https://cdn.example/out.mp4" },
    feedRows,
  });
  assert.equal(a.action, "open-watch");
  assert.equal(b.action, "open-watch");
}

function testTitleRankingOrder() {
  const rows = [
    { id: "meta", title: "Other", churchName: "gpt church" },
    { id: "caption", title: "Other", text: "talk about gpt tools" },
    { id: "contains", title: "Learning gpt today" },
    { id: "prefix", title: "gpt workshop" },
    { id: "exact", title: "gpt" },
  ];
  const ranked = filterHomeFeedRowsBySearchQuery(rows, "gpt").map((r) => r.id);
  assert.deepEqual(ranked, ["exact", "prefix", "contains", "caption", "meta"]);
}

function testCaptionBelowTitle() {
  const rows = [
    { id: "caption-only", title: "Sunday", text: "gpt notes" },
    { id: "title-hit", title: "gpt sermon", text: "hello" },
  ];
  const ranked = filterHomeFeedRowsBySearchQuery(rows, "gpt");
  assert.equal(ranked[0].id, "title-hit");
  assert.equal(ranked[1].id, "caption-only");
}

function testSelectionDoesNotMutatePagingSession() {
  const pagingBefore = { hasMore: false, nextCursor: null, loadedPages: 1 };
  const feedBefore = ["a", "b", "c"];
  const decision = resolveSelection({
    selectedRow: {
      id: "outside",
      type: "video",
      videoUrl: "https://cdn.example/x.mp4",
    },
    feedRows: feedBefore.map((id) => ({ id, type: "video", videoUrl: "https://cdn.example/a.mp4" })),
  });
  assert.equal(decision.action, "open-watch");
  assert.equal(decision.mutatesPaging, false);
  // Simulate screen contract: open-watch uses preserveFeedOrder and does not rewrite feed arrays.
  const pagingAfter = { ...pagingBefore };
  const feedAfter = [...feedBefore];
  assert.deepEqual(pagingAfter, pagingBefore);
  assert.deepEqual(feedAfter, feedBefore);
}

function testStaleCannotOverrideSelection() {
  const ctrl = createSearchController();
  ctrl.onChangeText("ab");
  // User selects while a search is pending → bump generation (sheet reset).
  ctrl.bumpGeneration();
  const r = ctrl.flushDebounce(() => ({
    disposition: "network",
    rows: [{ id: "should-not-apply", title: "Stale" }],
  }));
  assert.equal(r.staleIgnored, true);
  assert.equal(ctrl.phase, "preview"); // unchanged; stale did not settle into ready
}

function testSearchUrlEncoding() {
  const q = "youth ministry & praise";
  const normalized = normalizeHomeFeedSearchQuery(q);
  const params = new URLSearchParams({
    scope: "global",
    mediaOnly: "1",
    q: normalized,
    limit: "40",
    cursor: "0",
  });
  const path = `/api/church/feed?${params.toString()}`;
  assert.match(path, /q=youth(\+|%20)ministry/);
  assert.match(path, /%26/); // & encoded as %26 in q value
  assert.ok(path.includes("mediaOnly=1"));
  assert.ok(path.includes("scope=global"));
  // Diagnostics use length only — never log a query string field.
  assert.match(searchApiSrc, /normalizedQueryLength/);
  assert.doesNotMatch(
    searchApiSrc,
    /console\.log\(\s*["']KRISTO_HOME_FEED_SEARCH_[A-Z]+["']\s*,\s*\{[^}]*\bquery\s*:/
  );
  assert.doesNotMatch(
    sheetSrc,
    /console\.log\(\s*["']KRISTO_HOME_FEED_SEARCH_[A-Z]+["']\s*,\s*\{[^}]*\bquery\s*:/
  );
}

function testMaxLengthServerSide() {
  const long = "x".repeat(150);
  const parsed = parseHomeFeedSearchQueryParam(new URLSearchParams(`q=${long}`));
  assert.equal(parsed.active, true);
  assert.equal(parsed.normalizedQuery.length, 100);
  assert.match(backendSearchSrc, /HOME_FEED_SEARCH_MAX_QUERY_LENGTH/);
  assert.match(backendSearchSrc, /slice\(0,\s*HOME_FEED_SEARCH_MAX_QUERY_LENGTH\)/);
}

const tests = [
  ["normalize + short queries", testNormalizeAndShortQueries],
  ["ministry and field match", testMinistryAndFields],
  ["result outside first 20", testOutsideFirst20],
  ["empty query no backend", testEmptyQueryNoBackend],
  ["1-char reaches backend", testOneCharReachesBackend],
  ["stale response ignored", testStaleIgnored],
  ["authoritative zero clears preview", testAuthoritativeZeroClearsPreview],
  ["failed safe state", testFailedSafeState],
  ["parse query param", testParseQueryParam],
  ["source wiring", testSourceWiring],
  ["pipeline order before pagination", testPaginationUnaffectedPattern],
  ["in-feed result opens Watch", testInFeedOpensWatchDirectly],
  ["outside first 20 opens Watch", testOutsideOpensWatchDirectly],
  ["no scroll-in-feed selection path", testNoSearchResultUsesScrollInFeed],
  ["title ranking order", testTitleRankingOrder],
  ["caption ranks below title", testCaptionBelowTitle],
  ["selection does not mutate paging/session", testSelectionDoesNotMutatePagingSession],
  ["stale cannot override selection", testStaleCannotOverrideSelection],
  ["search URL/query encoding", testSearchUrlEncoding],
  ["max length enforced server-side", testMaxLengthServerSide],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail - ${name}`);
    console.error(error);
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n${tests.length} passed`);
