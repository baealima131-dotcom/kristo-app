import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const mobile = (p: string) => fs.readFileSync(path.join(process.cwd(), "apps/mobile", p), "utf8");
const cache = mobile("src/lib/homeFeedVideoDiskCache.ts");
const watch = mobile("src/components/homeFeed/HomeFeedWatchScreen.tsx");

test("disk cache key is the full URL (query kept: YouTube ?v= must not collapse to one entry)", () => {
  assert.match(cache, /function normalizeUrl\(url: string\) \{\s*return String\(url \|\| ""\)\.trim\(\);\s*\}/);
  assert.doesNotMatch(cache, /split\("\?"\)\[0\]/);
});

test("external video pages (YouTube/TikTok/Facebook) are never downloaded or read from the disk cache", () => {
  assert.match(cache, /EXTERNAL_VIDEO_PAGE_HOST = \/\(\^\|\\\.\)\(youtube\\\.com\|youtube-nocookie\\\.com\|youtu\\\.be\|tiktok\\\.com\|facebook\\\.com\|fb\\\.watch\)\$\/i/);
  // Every entry point checks it: Watch hydrate, Up Next schedule, lookup, download, prefetch, index.
  for (const marker of [
    "if (!remote || !isCacheableVideoUrl(remote)) {",
    "if (!postId || !remote || !isCacheableVideoUrl(remote)) return;",
    "if (!isCacheableVideoUrl(remote)) return null;",
    "if (!normalized || !isCacheableVideoUrl(remote)) return null;",
    "if (!normalized || !isCacheableVideoUrl(url) || seen.has(normalized)) return;",
    "if (!url || !isCacheableVideoUrl(url)) return;",
    "if (!isCacheableVideoUrl(entry.remoteUrl)) return;",
  ]) {
    assert.ok(cache.includes(marker), marker);
  }
  // Only the helper itself still checks plain network URLs.
  assert.equal((cache.match(/isNetworkUrl\(/g) || []).length, 2);
});

test("Watch never starts a second full download of the video it is playing (iOS and Android)", () => {
  const fn = cache.slice(cache.indexOf("export async function hydrateAndCacheWatchVideo("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /cacheVideoUrl\(remote, \{\s*allowDuringWatch: true,\s*cacheOnly: true,\s*\}\)/);
});

test("Watch pins the playback source per opened video (no mid-start swap to the disk cache)", () => {
  assert.match(watch, /const pinKey = `\$\{postId\}\|\$\{String\(payload\.videoUri \|\| ""\)\.trim\(\)\}`;/);
  assert.match(watch, /if \(pinnedPlaybackRef\.current\?\.key !== pinKey\) \{\s*pinnedPlaybackRef\.current = \{ key: pinKey, uri: resolveWatchScreenPlaybackUri\(payload\) \};\s*\}/);
  assert.match(watch, /const playbackUri = pinnedPlaybackRef\.current\.uri;/);
});

test("YouTube: the cover stays above the player until it reports playing (no black opening)", () => {
  const fn = watch.slice(watch.indexOf("function WatchYouTubeVideoSurface("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /const \{ webViewRef, ended, started, failed, onMessage, replay \} = useExternalPlayerState\(/);
  assert.match(body, /\{html && !failed && !ended && !started \? \(\s*(\/\/[^\n]*\n\s*)*<WatchStartCover uri=\{cover\.uri\} contain=\{cover\.contain\} \/>/);
  // After the WebView in the tree (on top), with YouTube's own thumbnail when no cover is saved.
  assert.ok(body.indexOf("<WatchStartCover") > body.indexOf("<WebView"));
  assert.match(body, /https:\/\/i\.ytimg\.com\/vi\/\$\{videoId\}\/hqdefault\.jpg/);
});

test("Uploads: the saved cover stays above VideoView until its first frame", () => {
  assert.match(watch, /onFirstFrameRender=\{\(\) => \{[\s\S]{0,300}setFirstFrameKey\(pinKey\);/);
  assert.match(watch, /\{!firstFrameShown && startPosterUri \? \(\s*(\/\/[^\n]*\n\s*)*<WatchStartCover\s+uri=\{startPosterUri\}\s+contain=\{displayType !== "youtube"\}/);
  assert.match(watch, /for \(const raw of \[item\?\.videoPosterUri, item\?\.posterUri, item\?\.thumbnailUri, item\?\.thumbnailUrl, item\?\.posterUrl\]\)/);
  // Never covers the video forever: hidden 6 s after readyToPlay if the first-frame event is missing.
  assert.match(watch, /event\?\.status === "readyToPlay" && !firstFrameFallbackRef\.current/);
});

test("Uploads: cover and VideoView share one frame (the video's own box), no layout jump", () => {
  // The start cover of an upload is drawn in containedVideoSize, the same box as the VideoView.
  assert.match(watch, /<WatchStartCover[\s\S]{0,200}frame=\{displayType === "youtube" \? null : containedVideoSize\}/);
  assert.match(watch, /style=\{\[\s*displayType === "youtube" \? styles\.video : \[styles\.videoPortrait, containedVideoSize\],/);
  const fn = watch.slice(watch.indexOf("function WatchStartCover("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /frame \? \[styles\.watchStartCoverFramed, frame\] : StyleSheet\.absoluteFillObject/);
  assert.match(body, /foregroundResizeMode=\{frame \? "cover" : contain \? "contain" : "cover"\}/);
  assert.match(watch, /watchStartCoverFramed: \{ position: "absolute", overflow: "hidden", alignSelf: "center" \}/);
});

test("Uploads without saved dimensions: the cover's shape decides the first frame", () => {
  const memory = mobile("src/lib/videoAspectMemory.ts");
  const poster = mobile("src/components/homeFeed/VideoPostFallbackPoster.tsx");
  assert.match(memory, /export function notePosterAspect\(videoUrl: unknown, width: unknown, height: unknown\)/);
  assert.match(memory, /export function peekPosterAspect\(videoUrl: unknown\): number \| undefined/);
  // Memory only: poster guesses are never persisted with the played shapes.
  assert.doesNotMatch(memory.slice(memory.indexOf("const posterAspects")), /schedulePersist\(\)/);
  // Home (and the Watch backdrop) note the loaded cover's size, except branded placeholders.
  assert.equal((poster.match(/notePosterAspect\(resolvedVideoUrl, loadedSize\.width, loadedSize\.height\)/g) || []).length, 2);
  assert.equal((poster.match(/!isBrandedPosterUri\((displayUri|activeDisplayUri)\)/g) || []).length >= 2, true);
  // Order: saved dimensions, played track, remembered shape, cover shape, family default.
  assert.match(watch, /metadataAspect \?\?\s*detectedForPost\?\.aspect \?\?\s*rememberedAspect \?\?\s*posterAspect \?\?\s*defaultHomeFeedVideoAspectRatio/);
  assert.match(watch, /\(posterAspect \? resolveHomeFeedVideoDisplayTypeFromDimensions\(posterAspect, 1\) : null\)/);
  // Shape unknown: the video box waits (hidden) up to 700 ms instead of drawing a default frame.
  assert.match(watch, /const holdVideoBox = !videoAspectKnown && aspectWaitOverKey !== pinKey && !firstFrameShown;/);
  assert.match(watch, /setTimeout\(\(\) => setAspectWaitOverKey\(pinKey\), 700\)/);
  assert.match(watch, /onPosterAspect=\{handlePosterAspect\}/);
});

test("Start cover never blocks touches and sits above the player", () => {
  const fn = watch.slice(watch.indexOf("function WatchStartCover("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /pointerEvents="none"/);
  assert.match(watch, /watchStartCover: \{ zIndex: 5, elevation: 5 \}/);
  assert.doesNotMatch(watch, /TEMPDIAG/);
});
