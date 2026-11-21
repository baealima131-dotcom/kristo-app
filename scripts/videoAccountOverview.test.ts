import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import * as server from "../app/api/_lib/videoAccountKey.ts";
import * as mobile from "../apps/mobile/src/lib/videoAccountKey.ts";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const UC = "UCSMOQeBJ2RAnuFungnQOxLg";
const fixtures: Array<{ item: any; key: string; kind: string }> = [
  { item: { videoDisplayType: "youtube", creatorId: UC, creatorName: "Blender" }, key: `youtube:channel:${UC}`, kind: "strong" },
  { item: { videoDisplayType: "youtube", creatorProfileUrl: `https://www.youtube.com/channel/${UC}`, creatorName: "Blender" }, key: `youtube:channel:${UC}`, kind: "strong" },
  { item: { videoDisplayType: "youtube", creatorId: "https://www.youtube.com/@BlenderOfficial", creatorName: "Blender" }, key: "youtube:@blenderofficial", kind: "strong" },
  { item: { videoDisplayType: "youtube", creatorId: "https://www.youtube.com/c/Kwaya", creatorName: "Kwaya" }, key: "youtube:c:kwaya", kind: "strong" },
  { item: { videoDisplayType: "tiktok", creatorId: "https://www.tiktok.com/@Mchungaji.Joe", creatorName: "Joe" }, key: "tiktok:@mchungaji.joe", kind: "strong" },
  { item: { videoDisplayType: "facebook", creatorProfileUrl: "https://m.facebook.com/KanisaLetu/", creatorName: "Kanisa" }, key: "facebook:facebook.com/kanisaletu", kind: "strong" },
  { item: { videoDisplayType: "facebook", creatorProfileUrl: "https://www.facebook.com/profile.php?id=1234", creatorName: "X" }, key: "facebook:facebook.com/profile.php?id=1234", kind: "strong" },
  { item: { videoDisplayType: "tiktok", creatorName: "  Kwaya   Kuu " }, key: "tiktok:name:kwaya kuu", kind: "name" },
  { item: { videoDisplayType: "tiktok" }, key: "", kind: "none" },
];

test("account keys: YouTube channel id / handle, TikTok handle, Facebook page, name, none", () => {
  for (const { item, key, kind } of fixtures) {
    const identity = server.videoAccountIdentity(item);
    assert.equal(identity.key, key, JSON.stringify(item));
    assert.equal(identity.kind, kind, JSON.stringify(item));
  }
});

test("server and app compute the same account keys (kept in sync)", () => {
  for (const { item } of fixtures) {
    assert.deepEqual(mobile.videoAccountIdentity(item), server.videoAccountIdentity(item), JSON.stringify(item));
  }
  assert.equal(mobile.normalizeVideoAccountName(" Ä  b "), server.normalizeVideoAccountName(" Ä  b "));
});

test("matching: same key; YouTube channel id vs handle by channel name; never across platforms", () => {
  const id = (item: any) => server.videoAccountIdentity(item);
  const ucBlender = id({ videoDisplayType: "youtube", creatorId: UC, creatorName: "Blender" });
  const handleBlender = id({ videoDisplayType: "youtube", creatorId: "https://www.youtube.com/@BlenderOfficial", creatorName: "Blender" });
  const handleStudio = id({ videoDisplayType: "youtube", creatorId: "https://www.youtube.com/@BlenderStudio", creatorName: "Blender Studio" });
  const handleOtherSameName = id({ videoDisplayType: "youtube", creatorId: "https://www.youtube.com/@AnotherBlender", creatorName: "Blender" });
  assert.equal(server.videoAccountsMatch(ucBlender, ucBlender), true);
  assert.equal(server.videoAccountsMatch(ucBlender, handleBlender), true);
  assert.equal(server.videoAccountsMatch(handleBlender, handleStudio), false);
  // Two different handles are two accounts even with the same display name.
  assert.equal(server.videoAccountsMatch(handleBlender, handleOtherSameName), false);
  const tiktokBlender = id({ videoDisplayType: "tiktok", creatorName: "Blender" });
  assert.equal(server.videoAccountsMatch(handleBlender, tiktokBlender), false);
  const nameOnly = id({ videoDisplayType: "youtube", creatorName: "blender" });
  assert.equal(server.videoAccountsMatch(handleBlender, nameOnly), true);
  const none = id({ videoDisplayType: "youtube" });
  assert.equal(server.videoAccountsMatch(none, none), false);
});

test("only visible video links are listed (deleted / hidden / invalid links stay out)", () => {
  const ok = { source: "system-admin-video-link", videoUrl: "https://www.youtube.com/watch?v=abc" };
  assert.equal(server.isVisibleVideoLinkItem(ok), true);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, deleted: true }), false);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, hiddenBySystemAdmin: true }), false);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, hiddenByReports: true }), false);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, status: "deleted" }), false);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, videoUrl: "http://www.youtube.com/watch?v=abc" }), false);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, videoUrl: "https://evil.example/watch" }), false);
  assert.equal(server.isVisibleVideoLinkItem({ ...ok, source: "media-upload" }), false);
});

test("GET /api/video-accounts is read-only and signed-in only", () => {
  const route = read("app/api/video-accounts/route.ts");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // Only a GET handler (no POST / PATCH / PUT / DELETE).
  assert.match(code, /export async function GET\(/);
  assert.doesNotMatch(code, /export async function (POST|PATCH|PUT|DELETE)\b/);
  assert.match(code, /await guardAuth\(req\)/);
  // No write helpers or SQL writes (the Home Feed list's enrichment may upsert posters; not used here).
  assert.doesNotMatch(code, /upsert|insert|update[A-Z(]|delete[A-Z(]|save[A-Z(]|write[A-Z(]|record[A-Z(]|sql`|safeEnrichFeedListItem|enrichFeedListItem/i);
  // Reads only: feed items, like meta, comment counts.
  assert.match(code, /listFeedItems\(\)/);
  assert.match(code, /getPostLikeMeta\(/);
  assert.match(code, /countDiscussionForPostIds\(/);
});

test("Home Feed / Watch author avatar and name open the in-app account page, never an external URL", () => {
  const row = read("apps/mobile/src/components/homeFeed/FeedChurchBrandRow.tsx");
  assert.doesNotMatch(row, /Linking/);
  assert.doesNotMatch(row, /externalCreatorPageUrl/);
  assert.match(row, /if \(externalVideoAccount\) openVideoAccount\(source\);/);
  assert.match(row, /if \(externalVideoAccount\) openVideoAccount\(source \? `\$\{source\}-avatar` : undefined\);/);
  // Church posts keep opening the Church Overview.
  assert.match(row, /else openChurchOverviewFromFeedItem\(item, \{ source \}\);/);
  // A link without account id / profile URL / name is not clickable.
  assert.match(row, /const canOpen = externalVideoAccount \? videoAccountOpenable : Boolean\(churchId\);/);
  const nav = read("apps/mobile/src/lib/videoAccountNavigation.ts");
  assert.match(nav, /pathname: "\/video-account"/);
  assert.match(nav, /if \(!identity\.key\) return false;/);
});

test("account page: no church-only fields, videos open in the existing Home Watch", () => {
  const page = read("apps/mobile/app/video-account.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["Send Request", "Pastor", "Ministries", "members", "Location", "handleJoin", "ChurchReportSheet"]) {
    assert.ok(!page.includes(forbidden), forbidden);
  }
  // Avatar, name, platform chip, Kristo App video count, list of videos.
  assert.match(page, /videoAccountPlatformLabel\(provider\)/);
  assert.match(page, /Video kwenye Kristo App/);
  assert.match(page, /items\.map\(\(item\) =>/);
  // No second player on this page: it queues the row for the Home Watch.
  assert.doesNotMatch(page, /VideoView|WebView|HomeFeedWatchScreen|useVideoPlayer/);
  assert.match(page, /queueHomeFeedWatchRequest\(item, "video-account"\)/);
  const home = read("apps/mobile/src/components/homeFeed/HomeFeedScreen.tsx");
  assert.match(home, /const request = consumeHomeFeedWatchRequest\(\);[\s\S]{0,200}buildHomeFeedVideoOpenPayload\(request\.item\)[\s\S]{0,200}handleVideoPress\(payload\);/);
});

test("the Watch request is used once and expires", async () => {
  const req = await import("../apps/mobile/src/lib/homeFeedWatchRequest.ts");
  assert.equal(req.queueHomeFeedWatchRequest({ id: "p1" }, "test"), true);
  assert.equal(req.consumeHomeFeedWatchRequest()?.postId, "p1");
  assert.equal(req.consumeHomeFeedWatchRequest(), null);
  req.queueHomeFeedWatchRequest({ id: "p2" }, "test");
  assert.equal(req.consumeHomeFeedWatchRequest(Date.now() + req.HOME_FEED_WATCH_REQUEST_TTL_MS + 1), null);
  assert.equal(req.queueHomeFeedWatchRequest({}, "test"), false);
});
