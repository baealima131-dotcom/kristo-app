import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  externalCreatorPageUrl,
  youtubeChannelPageUrl,
} from "../apps/mobile/src/lib/externalCreatorPage";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/components/homeFeed", p), "utf8");
const brand = read("FeedChurchBrandRow.tsx");
const identity = read("FeedIdentity.tsx");

function block(src: string, start: string) {
  const at = src.indexOf(start);
  assert.ok(at > 0, `missing ${start}`);
  return src.slice(at, src.indexOf("}, [", at));
}

test("Kristo/church posts: avatar and name open the Church Overview (Home and Watch)", () => {
  const name = block(brand, "const openProfile = useCallback(");
  const avatar = block(brand, "const openAvatarTarget = useCallback(");
  assert.match(name, /else openChurchOverviewFromFeedItem\(item, \{ source \}\);/);
  assert.match(avatar, /else openChurchOverviewFromFeedItem\(item, \{ source: source \? `\$\{source\}-avatar` : undefined \}\);/);
  assert.doesNotMatch(brand, /openChurchProfileFromFeedItem|avatarOpensOverview/);
});

test("video links: avatar and name open the creator page only; nothing when there is none", () => {
  assert.match(brand, /externalVideoAccount \? externalCreatorPageUrl\(item\) : null/);
  assert.match(brand, /const canOpen = externalVideoAccount \? Boolean\(creatorPageUrl\) : Boolean\(churchId\);/);
  assert.match(block(brand, "const openProfile = useCallback("), /if \(externalVideoAccount\) openExternalProfile\(\);/);
  assert.match(block(brand, "const openAvatarTarget = useCallback("), /if \(externalVideoAccount\) openExternalProfile\(\);/);
  assert.match(block(brand, "const openExternalProfile = useCallback("), /if \(creatorPageUrl\) void Linking\.openURL\(creatorPageUrl\)\.catch/);
});

test("classic feed identity: name and avatar both open the Church Overview", () => {
  assert.match(block(identity, "const openChurchProfile = useCallback("), /openChurchOverviewFromFeedItem\(item, \{ source: "home-feed-identity" \}\)/);
  assert.match(block(identity, "const openChurchOverview = useCallback("), /openChurchOverviewFromFeedItem\(item, \{ source: "home-feed-identity-avatar" \}\)/);
});

test("YouTube: the channel page only", () => {
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "youtube", creatorProfileUrl: "https://www.youtube.com/@BlenderOfficial" }), "https://www.youtube.com/@BlenderOfficial");
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "youtube", creatorProfileUrl: "https://www.youtube.com/watch?v=abc" }), null);
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "youtube", videoUrl: "https://www.youtube.com/watch?v=abc" }), null);
  assert.equal(youtubeChannelPageUrl("https://www.youtube.com/channel/UCabcdefghij1234567890"), "https://www.youtube.com/channel/UCabcdefghij1234567890");
});

test("TikTok: saved profile link or the @handle in the video link", () => {
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "tiktok", videoUrl: "https://www.tiktok.com/@nasa/video/7676868860749827342" }), "https://www.tiktok.com/@nasa");
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "tiktok", creatorProfileUrl: "https://www.tiktok.com/@kristo.app" }), "https://www.tiktok.com/@kristo.app");
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "tiktok", videoUrl: "https://vm.tiktok.com/ZMabc/" }), null);
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "tiktok", videoUrl: "http://www.tiktok.com/@nasa/video/1" }), null);
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "tiktok", videoUrl: "https://evil.example/@nasa/video/1" }), null);
});

test("Facebook: saved Page link or the Page in a /page/videos/id link; none for /watch or /reel", () => {
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "facebook", videoUrl: "https://www.facebook.com/NASA/videos/123456" }), "https://www.facebook.com/NASA");
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "facebook", creatorProfileUrl: "https://www.facebook.com/kristoapp" }), "https://www.facebook.com/kristoapp");
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "facebook", videoUrl: "https://www.facebook.com/watch/?v=123" }), null);
  assert.equal(externalCreatorPageUrl({ videoDisplayType: "facebook", videoUrl: "https://www.facebook.com/reel/123" }), null);
});

test("missing or broken data never throws", () => {
  for (const item of [null, undefined, {}, { videoDisplayType: "tiktok" }, { videoDisplayType: "facebook", videoUrl: "::::" }, { videoDisplayType: "other", creatorProfileUrl: "https://x.y" }]) {
    assert.equal(externalCreatorPageUrl(item as any), null);
  }
});
