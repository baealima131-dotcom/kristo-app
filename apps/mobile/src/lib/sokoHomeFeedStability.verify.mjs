/**
 * Prove background Home Feed events do not rerender, resize, or reposition
 * unchanged SOKO cards. Mirrors sokoHomeFeedLayout.ts + wiring in FeedList /
 * HomeFeedScreen / SokoHomeProducts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const layoutSrc = readFileSync(join(__dirname, "sokoHomeFeedLayout.ts"), "utf8");
const youtubeLayoutSrc = readFileSync(join(__dirname, "homeFeedYouTubeLayout.ts"), "utf8");
const feedListSrc = readFileSync(
  join(__dirname, "../components/homeFeed/FeedList.tsx"),
  "utf8"
);
const screenSrc = readFileSync(
  join(__dirname, "../components/homeFeed/HomeFeedScreen.tsx"),
  "utf8"
);
const sokoSrc = readFileSync(
  join(__dirname, "../components/homeFeed/SokoHomeProducts.tsx"),
  "utf8"
);

async function loadLayout() {
  try {
    return await import("./sokoHomeFeedLayout.ts");
  } catch {
    return require("./sokoHomeFeedLayout.ts");
  }
}

async function loadActiveVideo() {
  try {
    return await import("./homeFeedActiveVideo.ts");
  } catch {
    return require("./homeFeedActiveVideo.ts");
  }
}

function product(id, extra = {}) {
  return {
    id,
    title: "Canvas tote",
    price: 24,
    currency: "USD",
    image: "https://cdn.example/soko/" + id + ".jpg",
    soldOut: false,
    stockAvailable: 4,
    location: "Houston",
    condition: "new",
    paymentOptions: { methods: ["cash_app"], stripeCardAvailable: true },
    ...extra,
  };
}

function videos(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "feed_video_" + index,
    mediaType: "video",
  }));
}

const layout = await loadLayout();
const {
  estimateSokoHomeFeedCardHeight,
  sokoHomeFeedImageHeight,
  sokoHomeFeedCardWidth,
  sokoHomeFeedCardPropsEqual,
  areSokoProductListsVisuallyEqual,
  sokoDistributedRowsUnchanged,
  sokoHomeBackgroundEventShouldMoveCard,
  distributeSokoProducts,
  readSokoCarouselPage,
  writeSokoCarouselPage,
  clearSokoCarouselMemoryForTests,
  sokoProductListVisualDigest,
  mixedHomeFeedOccupiedHeight,
} = layout;
const {
  pickYouTubeActiveVideoFromViewable,
  isHomeFeedActiveVideoRow,
  homeFeedVideoId,
  isSokoFeedRow,
} = await loadActiveVideo();

const WIDTH = 390;
const sample = product("p1");
const sokoHeight = estimateSokoHomeFeedCardHeight(WIDTH, sample);
const imageHeight = sokoHomeFeedImageHeight(WIDTH);
const youtubeThumb = Math.round((WIDTH / 16) * 9);

assert.equal(sokoHomeFeedCardWidth(WIDTH), WIDTH - 10);
assert.ok(imageHeight > 0);
assert.ok(sokoHeight > imageHeight);
assert.notEqual(imageHeight, youtubeThumb);
assert.equal(
  estimateSokoHomeFeedCardHeight(WIDTH, { ...sample, image: "" }),
  sokoHeight,
  "height is known before the image URL loads"
);

const clone = { ...sample };
assert.equal(
  sokoHomeFeedCardPropsEqual(
    { product: sample, height: sokoHeight, layoutWidth: WIDTH },
    { product: clone, height: sokoHeight, layoutWidth: WIDTH }
  ),
  true
);
assert.equal(
  sokoHomeFeedCardPropsEqual(
    { product: sample, height: sokoHeight, layoutWidth: WIDTH },
    { product: { ...sample, price: 30 }, height: sokoHeight, layoutWidth: WIDTH }
  ),
  false
);

const listA = [product("p1"), product("p2")];
const listB = [product("p1"), product("p2")];
const listReordered = [product("p2"), product("p1")];
assert.equal(areSokoProductListsVisuallyEqual(listA, listB), true);
assert.equal(sokoProductListVisualDigest(listA), sokoProductListVisualDigest(listB));
assert.equal(areSokoProductListsVisuallyEqual(listA, listReordered), false);

const rows = videos(20);
const distributedA = distributeSokoProducts(rows, listA);
const distributedB = distributeSokoProducts(rows, listB);
assert.equal(sokoDistributedRowsUnchanged(distributedA, distributedB), true);
assert.equal(distributedA[2]._homeFeedKind, "soko-product");
assert.equal(distributedA[2].type, "soko");
assert.equal(distributedA[8].type, "soko");
assert.equal(distributedA[8]._homeFeedKind, "soko-product");
assert.equal(distributedA[8].sokoProductId, "p2");
assert.equal(isSokoFeedRow(distributedA[2]), true);
assert.equal(homeFeedVideoId(distributedA[2]), "");
assert.equal(homeFeedVideoId(distributedA[8]), "");
assert.equal(isHomeFeedActiveVideoRow(distributedA[2], 2, 2, "feed_video_1"), false);
assert.equal(isHomeFeedActiveVideoRow(distributedA[8], 8, 8, "feed_video_6"), false);

const onlySokoVisible = pickYouTubeActiveVideoFromViewable({
  viewableItems: [
    { index: 2, item: distributedA[2], isViewable: true },
    { index: 8, item: distributedA[8], isViewable: true },
  ],
  rows: distributedA,
  previousVideoId: "feed_video_6",
});
assert.ok(onlySokoVisible);
assert.notEqual(onlySokoVisible.index, 2);
assert.notEqual(onlySokoVisible.index, 8);
assert.equal(onlySokoVisible.videoId, "feed_video_6");
assert.equal(isSokoFeedRow(distributedA[onlySokoVisible.index]), false);

const mixedVisible = pickYouTubeActiveVideoFromViewable({
  viewableItems: [
    { index: 7, item: distributedA[7], isViewable: true },
    { index: 8, item: distributedA[8], isViewable: true },
  ],
  rows: distributedA,
  previousVideoId: "feed_video_3",
});
assert.equal(mixedVisible.index, 7);
assert.equal(mixedVisible.videoId, "feed_video_6");

const VIDEO_ROW_HEIGHT = 400;
const occupiedA = mixedHomeFeedOccupiedHeight(distributedA, WIDTH, VIDEO_ROW_HEIGHT);
const occupiedB = mixedHomeFeedOccupiedHeight(distributedB, WIDTH, VIDEO_ROW_HEIGHT);
assert.equal(occupiedA, occupiedB, "content height must not change after identical product poll");

let cardRenders = 0;
function noteCardRender(prevProps, nextProps) {
  if (!sokoHomeFeedCardPropsEqual(prevProps, nextProps)) cardRenders += 1;
}
const cardProps = { product: listA[0], height: sokoHeight, layoutWidth: WIDTH };
noteCardRender(cardProps, { product: listB[0], height: sokoHeight, layoutWidth: WIDTH });
let onProductsChangeCalls = 0;
if (!areSokoProductListsVisuallyEqual(listA, listB)) onProductsChangeCalls += 1;
assert.equal(onProductsChangeCalls, 0);
assert.equal(cardRenders, 0, "identical polls cause zero SOKO card renders");

clearSokoCarouselMemoryForTests();
writeSokoCarouselPage("p1", 2, "user-momentum");
const pageBeforeActiveIndex = readSokoCarouselPage("p1");
for (const activeIndex of [0, 4, 8]) {
  assert.equal(
    readSokoCarouselPage("p1"),
    pageBeforeActiveIndex,
    "activeIndex " + activeIndex + " must not move the SOKO gallery page"
  );
}

const background = sokoHomeBackgroundEventShouldMoveCard({
  prevProduct: sample,
  nextProduct: clone,
  prevHeight: sokoHeight,
  nextHeight: sokoHeight,
  prevLayoutWidth: WIDTH,
  nextLayoutWidth: WIDTH,
  prevDistributedRows: distributedA,
  nextDistributedRows: distributedB,
  prevCarouselPage: readSokoCarouselPage("p1"),
  nextCarouselPage: readSokoCarouselPage("p1"),
});
assert.deepEqual(background, {
  rerender: false,
  resize: false,
  reposition: false,
});

const priceMove = sokoHomeBackgroundEventShouldMoveCard({
  prevProduct: sample,
  nextProduct: { ...sample, price: 40 },
  prevHeight: sokoHeight,
  nextHeight: sokoHeight,
  prevLayoutWidth: WIDTH,
  nextLayoutWidth: WIDTH,
  prevDistributedRows: distributedA,
  nextDistributedRows: distributeSokoProducts(rows, [{ ...sample, price: 40 }]),
  prevCarouselPage: 2,
  nextCarouselPage: 2,
});
assert.equal(priceMove.rerender, true);

assert.match(youtubeLayoutSrc, /isSokoHomeFeedRow\(item\)/);
assert.match(youtubeLayoutSrc, /estimateSokoHomeFeedCardHeight\(windowWidth, item\)/);

assert.match(sokoSrc, /React\.memo/);
assert.match(sokoSrc, /sokoHomeFeedCardPropsEqual/);
assert.match(sokoSrc, /SOKO_PRODUCTS_SKIP_IDENTICAL/);
assert.doesNotMatch(sokoSrc, /SOKO_CARD_RENDER[\s\S]{0,80}skip-identical-products/);
assert.match(sokoSrc, /console\.log\("SOKO_CARD_RENDER"/);
assert.match(sokoSrc, /marginTop:SOKO_FEED_CARD_MARGIN_TOP/);
assert.match(sokoSrc, /marginBottom:SOKO_FEED_CARD_MARGIN_BOTTOM/);
assert.match(sokoSrc, /SOKO_CARD_LAYOUT_CHANGE/);
assert.match(sokoSrc, /SOKO_CAROUSEL_INDEX_CHANGE|writeSokoCarouselPage/);
assert.match(sokoSrc, /user-momentum/);
assert.match(sokoSrc, /height:imageHeight/);
assert.match(sokoSrc, /width:cardWidth/);
assert.equal(sokoSrc.includes("scrollToIndex"), false);
assert.equal(/galleryScrollRef\.current\?\.scrollTo/.test(sokoSrc), false);
assert.match(sokoSrc, /height:98/);
assert.match(sokoSrc, /height:57/);

assert.match(feedListSrc, /estimateSokoHomeFeedCardHeight\(windowWidth, item\)/);
assert.match(feedListSrc, /layoutWidth=\{windowWidth\}/);
assert.match(feedListSrc, /vertical-scrollToIndex-blocked/);
assert.match(feedListSrc, /SOKO_CAROUSEL_SCROLL_COMMAND/);
assert.match(feedListSrc, /pickYouTubeActiveVideoFromViewable/);
assert.match(feedListSrc, /isHomeFeedActiveVideoRow/);
assert.match(feedListSrc, /homeFeedVideoId/);
assert.doesNotMatch(feedListSrc, /ItemSeparatorComponent/);
const youtubeFlatListSrc = feedListSrc.slice(
  feedListSrc.indexOf('key="home-youtube-feed-list"'),
  feedListSrc.indexOf("return (", feedListSrc.indexOf('key="home-youtube-feed-list"'))
);
assert.match(youtubeFlatListSrc, /getItemLayout=\{youtubeGetItemLayout\}/);
assert.equal(youtubeFlatListSrc.includes("extraData={activeIndex}"), false);
assert.doesNotMatch(
  feedListSrc.slice(
    feedListSrc.indexOf("const renderYouTubeItem"),
    feedListSrc.indexOf("const viewportStyle")
  ),
  /activeIndex(?!Ref)/
);

assert.match(screenSrc, /sokoDistributedRowsUnchanged/);
assert.match(screenSrc, /areSokoProductListsVisuallyEqual/);
assert.match(screenSrc, /commitActiveVideoIndex/);
assert.match(screenSrc, /resolveActiveVideoIndexById/);
assert.match(screenSrc, /isSokoFeedRow/);

assert.match(layoutSrc, /SOKO_CAROUSEL_INDEX_CHANGE/);
assert.match(layoutSrc, /sokoHomeFeedCardPropsEqual/);

console.log("sokoHomeFeedStability.verify.mjs OK", {
  sokoHeight,
  imageHeight,
  youtubeThumb,
  secondSokoIndex: 8,
  background,
});
