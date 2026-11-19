import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { refreshRowsPlatformFields } from "../apps/mobile/src/components/homeFeed/homeFeedPlatformCounts";

const key = (row: any) => String(row?.id || "");
const link = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  source: "system-admin-video-link",
  videoDisplayType: "youtube",
  title: `Video ${id}`,
  ...extra,
});

test("cached link gets the server's new counts and unavailable flags", () => {
  const cached = [
    link("a", { platformStats: { views: null, likes: null, comments: null }, platformUnavailableFields: ["views", "likes", "comments"] }),
  ];
  const fresh = [
    link("a", {
      platformStats: { views: 123456, likes: 7890, comments: 321 },
      platformUnavailableFields: [],
      platformHiddenFields: [],
      platformStatsUpdatedAt: "2026-11-19T14:00:00Z",
    }),
  ];
  const result = refreshRowsPlatformFields(cached, fresh, key);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.rows[0].platformStats, { views: 123456, likes: 7890, comments: 321 });
  assert.deepEqual(result.rows[0].platformUnavailableFields, []);
  assert.deepEqual(result.rows[0].platformHiddenFields, []);
  assert.equal(result.rows[0].platformStatsUpdatedAt, "2026-11-19T14:00:00Z");
});

test("order, ids and other fields stay; nothing is added or removed", () => {
  const cached = [
    link("a", { platformStats: { views: 1 } }),
    { id: "upload-1", source: "media-upload", likeCount: 3 },
    link("b", { platformStats: { views: 2 }, title: "Old title" }),
  ];
  const fresh = [
    link("new", { platformStats: { views: 9 } }),
    link("b", { platformStats: { views: 20 }, title: "New title", posterUri: "https://x/y.jpg" }),
    link("a", { platformStats: { views: 10 } }),
  ];
  const result = refreshRowsPlatformFields(cached, fresh, key);
  assert.deepEqual(result.rows.map(key), ["a", "upload-1", "b"]);
  assert.equal(result.updated, 2);
  assert.equal(result.rows[1], cached[1], "non-link row is the same object");
  assert.equal(result.rows[2].title, "Old title", "only platform fields change");
  assert.equal(result.rows[2].posterUri, undefined);
  assert.equal(result.rows[2].platformStats.views, 20);
});

test("unchanged counts keep the same array and row objects (no re-render)", () => {
  const cached = [link("a", { platformStats: { views: 5, likes: 1, comments: 0 } })];
  const fresh = [link("a", { platformStats: { views: 5, likes: 1, comments: 0 } })];
  const result = refreshRowsPlatformFields(cached, fresh, key);
  assert.equal(result.updated, 0);
  assert.equal(result.rows, cached);
});

test("a field missing from the fresh row is never wiped; counts can go back to unavailable", () => {
  const cached = [link("a", { platformStats: { views: 5 }, facebookManualStats: { likes: 4 } })];
  const keep = refreshRowsPlatformFields(cached, [link("a", { platformStats: { views: 6 } })], key);
  assert.deepEqual(keep.rows[0].facebookManualStats, { likes: 4 });
  const gone = refreshRowsPlatformFields(cached, [link("a", { platformStats: { views: null } })], key);
  assert.deepEqual(gone.rows[0].platformStats, { views: null });
});

test("empty inputs are no-ops", () => {
  const cached = [link("a")];
  assert.equal(refreshRowsPlatformFields(cached, [], key).rows, cached);
  assert.deepEqual(refreshRowsPlatformFields([], [link("a")], key).rows, []);
});

const mobile = (p: string) => fs.readFileSync(path.join(process.cwd(), "apps/mobile", p), "utf8");

test("background probe refreshes visible session and page cache before skip checks", () => {
  const api = mobile("src/components/homeFeed/homeFeedApi.ts");
  const fn = api.slice(api.indexOf("export async function refreshHomeFeedYoutubeBackgroundCache"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  const refreshAt = body.indexOf("refreshHomeFeedYoutubeStreamPlatformFields(freshRows)");
  const pagesAt = body.indexOf("refreshHomeFeedStreamPagesPlatformFields(freshRows, viewerUserId)");
  const skipAt = body.indexOf("shouldSkipHomeFeedRowsStateUpdate(visibleRows, freshRows)");
  assert.ok(refreshAt > 0 && pagesAt > refreshAt && skipAt > pagesAt);
  // Probe still never reorders the live session; a smaller (partial) session only gets counts.
  assert.match(body, /commitMix: false/);
  const partialReturn = body.indexOf("if (!fullSession) {");
  assert.ok(partialReturn > pagesAt && partialReturn < skipAt);
  assert.ok(body.indexOf("markHomeFeedYoutubeRefreshAvailable") > partialReturn);
});

test("background poll that skips the network still refreshes counts (rows stay cached)", () => {
  const api = mobile("src/components/homeFeed/homeFeedApi.ts");
  const at = api.indexOf('note: "background-with-cache-paginated"');
  const block = api.slice(at, at + 500);
  assert.match(block, /void refreshHomeFeedYoutubeBackgroundCache\(reason\)/);
  assert.match(block, /return cachedRows;/);
});

test("page cache refresh rewrites pages in place (no prune, truncate or savedAt change)", () => {
  const cache = mobile("src/components/homeFeed/homeFeedPageCache.ts");
  const fn = cache.slice(cache.indexOf("export async function refreshHomeFeedStreamPagesPlatformFields"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /writePageToDisk\(uid, pageIndex, result\.rows, prev\)/);
  assert.doesNotMatch(body, /pruneHomeFeedDiskCacheBeforePage0Save|truncateHomeFeedStreamPagesAfter|savedAt|clearHomeFeedPageCache/);
});

test("Home re-renders refreshed rows without touching order or paging", () => {
  const screen = mobile("src/components/homeFeed/HomeFeedScreen.tsx");
  const at = screen.indexOf("subscribeHomeFeedYoutubeStreamRowsRefreshed((fresh, sessionUpdated) => {");
  assert.ok(at > 0);
  const block = screen.slice(at, at + 600);
  assert.match(block, /refreshHomeFeedRowsPlatformFields\(youtubeStreamRowsRef\.current, fresh\)/);
  assert.match(block, /bumpYoutubeRows\(\)/);
  assert.doesNotMatch(block, /replaceHomeFeedYoutubeStreamRows|saveHomeFeedYoutubeStreamSession|scrollTo|setActive/);
});

test("Home list notices new counts for the same video link; other rows still compare by id", async () => {
  const { sokoDistributedRowsUnchanged } = await import("../apps/mobile/src/lib/sokoHomeFeedLayout");
  const a = link("a", { platformStats: { views: 1 } });
  const upload = { id: "u1", source: "media-upload", title: "x" };
  assert.equal(sokoDistributedRowsUnchanged([a, upload], [{ ...a }, { ...upload, title: "y" }]), true);
  assert.equal(sokoDistributedRowsUnchanged([a, upload], [{ ...a, platformStats: { views: 2 } }, upload]), false);
  assert.equal(sokoDistributedRowsUnchanged([a], [{ ...a, platformUnavailableFields: ["likes"] }]), false);
});

test("count field lists stay identical in both files", () => {
  const pick = (src: string) => (src.match(/\[\s*("platformStats"[\s\S]*?)\]\s*as const/) || [])[1]?.replace(/\s+/g, "");
  const a = pick(mobile("src/components/homeFeed/homeFeedPlatformCounts.ts"));
  const b = pick(mobile("src/lib/sokoHomeFeedLayout.ts"));
  assert.ok(a && a === b, `${a} !== ${b}`);
});
