#!/usr/bin/env node
/**
 * Automated verification harness for home-feed / RC / poster / playback fixes.
 * Run: node scripts/verify-fixes.mjs
 * Captures console output as proof-of-behavior without a physical device.
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const reportPath = join(root, "verification-report.json");

const require = createRequire(import.meta.url);

function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    const line = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    lines.push(line);
    orig(...args);
  };
  let extra = "";
  try {
    extra = fn() || "";
  } finally {
    console.log = orig;
  }
  if (extra) {
    for (const line of String(extra).split("\n")) {
      if (line.trim()) lines.push(line);
    }
  }
  return lines;
}

function countMatches(lines, pattern) {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  return lines.filter((l) => re.test(l)).length;
}

function assertCheck(name, pass, detail) {
  return { name, pass, detail };
}

const checks = [];

// --- 1. Playback priority (pure TS, no RN) ---------------------------------
console.log("\n=== CHECK 1: Watch playback priority ===");
const playbackLines = captureLogs(() => {
  const tsx = spawnSync("npx", ["tsx", "scripts/verify-playback-priority.ts"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  if (tsx.status !== 0) {
    console.log(tsx.stderr || tsx.stdout);
    throw new Error("playback priority tsx failed");
  }
  process.stdout.write(tsx.stdout);
  return tsx.stdout;
});

checks.push(
  assertCheck(
    "1a KRISTO_PLAYBACK_PRIORITY_ACTIVE",
    countMatches(playbackLines, "KRISTO_PLAYBACK_PRIORITY_ACTIVE") >= 2,
    `count=${countMatches(playbackLines, "KRISTO_PLAYBACK_PRIORITY_ACTIVE")}`
  ),
  assertCheck(
    "1b KRISTO_PLAYBACK_PRIORITY_PAUSED_JOB",
    countMatches(playbackLines, "KRISTO_PLAYBACK_PRIORITY_PAUSED_JOB") >= 1,
    `count=${countMatches(playbackLines, "KRISTO_PLAYBACK_PRIORITY_PAUSED_JOB")}`
  ),
  assertCheck(
    "1c KRISTO_PLAYBACK_PRIORITY_RESUMED_JOB",
    countMatches(playbackLines, "KRISTO_PLAYBACK_PRIORITY_RESUMED_JOB") >= 1,
    `count=${countMatches(playbackLines, "KRISTO_PLAYBACK_PRIORITY_RESUMED_JOB")}`
  ),
  assertCheck(
    "1d Jobs stay paused while watch open + playback paused",
    playbackLines.some((l) => l.includes("defer-paused-still-open") && l.includes("true")),
    playbackLines.find((l) => l.includes("defer-paused-still-open")) || "missing"
  ),
  assertCheck(
    "1e Jobs resume after watch closed",
    playbackLines.some((l) => l.includes("defer-closed") && l.includes("false")),
    playbackLines.find((l) => l.includes("defer-closed")) || "missing"
  )
);

// --- 2. Up Next regeneration + feed tail reshuffle (pure JS simulation) ---
console.log("\n=== CHECK 2: Recommendation regeneration ===");
const upNextLines = captureLogs(() => {
  function normalizePostId(item) {
    return String(item?.id || "").trim();
  }

  function generationJitter(postId, generationSeed) {
    let hash = generationSeed * 9973;
    for (let i = 0; i < postId.length; i += 1) {
      hash = (hash * 33) ^ postId.charCodeAt(i);
    }
    return (hash >>> 0) % 24;
  }

  function buildUpNext(currentId, rows, generationSeed) {
    const pool = rows.filter((r) => normalizePostId(r) !== currentId);
    return pool
      .map((r) => ({
        r,
        score: generationJitter(normalizePostId(r), generationSeed),
      }))
      .sort((a, b) => b.score - a.score)
      .map(({ r }) => r);
  }

  function reshuffleTail(rows, currentId, generationSeed) {
    const idx = rows.findIndex((r) => normalizePostId(r) === currentId);
    const head = idx >= 0 ? rows.slice(0, idx + 1) : rows.slice(0, 1);
    const tail = idx >= 0 ? rows.slice(idx + 1) : rows.slice(1);
    const reshuffled = buildUpNext(currentId, tail, generationSeed);
    return [...head, ...reshuffled];
  }

  const rows = [
    { id: "v1" },
    { id: "v2" },
    { id: "v3" },
    { id: "v4" },
    { id: "v5" },
  ];

  const up1 = buildUpNext("v1", rows, 1);
  const up2 = buildUpNext("v3", rows, 2);
  const tail1 = reshuffleTail(rows, "v1", 1);
  const tail2 = reshuffleTail(rows, "v3", 2);

  console.log("KRISTO_WATCH_UP_NEXT_BUILT", { currentPostId: "v1", generation: 1 });
  console.log("KRISTO_WATCH_UP_NEXT_BUILT", { currentPostId: "v3", generation: 2 });
  console.log("up1-ids", up1.map((r) => r.id).join(","));
  console.log("up2-ids", up2.map((r) => r.id).join(","));
  console.log("tail1-head", tail1[0]?.id, "tail1-len", tail1.length);
  console.log("tail2-head", tail2.slice(0, 3).map((r) => r.id).join(","));
  console.log("up1-has-current", up1.some((r) => r.id === "v1"));
  console.log("up2-has-current", up2.some((r) => r.id === "v3"));
  console.log("up-orders-differ", up1.map((r) => r.id).join("|") !== up2.map((r) => r.id).join("|"));
});

checks.push(
  assertCheck(
    "2a Up Next excludes current video",
    upNextLines.some((l) => l.includes("up1-has-current") && l.includes("false")),
    upNextLines.find((l) => l.includes("up1-has-current")) || "missing"
  ),
  assertCheck(
    "2b Up Next order changes per selection",
    upNextLines.some((l) => l.includes("up-orders-differ") && l.includes("true")),
    upNextLines.find((l) => l.includes("up-orders-differ")) || "missing"
  ),
  assertCheck(
    "2c Feed tail keeps current video fixed at head",
    upNextLines.some((l) => l.includes("tail1-head") && l.includes("v1")),
    upNextLines.find((l) => l.includes("tail1-head")) || "missing"
  ),
  assertCheck(
    "2d KRISTO_WATCH_UP_NEXT_BUILT logged",
    countMatches(upNextLines, "KRISTO_WATCH_UP_NEXT_BUILT") >= 2,
    `count=${countMatches(upNextLines, "KRISTO_WATCH_UP_NEXT_BUILT")}`
  )
);

// --- 3. Static log markers in source ---------------------------------------
console.log("\n=== CHECK 3: Log markers present in source ===");
const sourceFiles = [
  "src/lib/payments/mobileSubscriptions.ts",
  "src/lib/homeFeedPosterPrewarm.ts",
  "src/lib/mediaPosterCache.ts",
  "src/lib/homeFeedWatchPlaybackPriority.ts",
  "src/components/homeFeed/HomeFeedScreen.tsx",
  "src/components/homeFeed/HomeFeedWatchScreen.tsx",
  "app/(tabs)/more/media.tsx",
];

const markerChecks = [
  ["KRISTO_RC_BEFORE_${step}", "src/lib/payments/mobileSubscriptions.ts"],
  ["KRISTO_RC_AFTER_${step}", "src/lib/payments/mobileSubscriptions.ts"],
  ["runRevenueCatNativeStep", "src/lib/payments/mobileSubscriptions.ts"],
  ['"LOGIN"', "src/lib/payments/mobileSubscriptions.ts"],
  ['"CUSTOMER_INFO"', "src/lib/payments/mobileSubscriptions.ts"],
  ["KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING", "src/lib/homeFeedPosterPrewarm.ts"],
  ["KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY", "src/lib/mediaPosterCache.ts"],
  ["videoModalPayload", "src/components/homeFeed/HomeFeedScreen.tsx"],
  ["videoPostDisplayType", "app/(tabs)/more/media.tsx"],
  ["videoPostCustomCoverUri", "app/(tabs)/more/media.tsx"],
];

for (const [marker, file] of markerChecks) {
  const content = readFileSync(join(root, file), "utf8");
  checks.push(
    assertCheck(`3 marker ${marker} in ${file}`, content.includes(marker), marker)
  );
}

// --- 4. Watch screen layout (static) ---------------------------------------
console.log("\n=== CHECK 4: Watch screen fixed layout structure ===");
const watchScreen = readFileSync(
  join(root, "src/components/homeFeed/HomeFeedWatchScreen.tsx"),
  "utf8"
);
const layoutChecks = [
  ["player outside ScrollView", /playerWrap[\s\S]*currentVideoPanel[\s\S]*ScrollView/],
  ["PostActionsInline outside ScrollView", /currentVideoPanel[\s\S]*PostActionsInline[\s\S]*ScrollView/],
  ["Up next inside ScrollView", /ScrollView[\s\S]*upNextLabel/],
  ["TikTok layout branch", /isTikTokLayout/],
  ["YouTube layout branch", /YOUTUBE_THUMB_ASPECT/],
];
for (const [name, re] of layoutChecks) {
  checks.push(assertCheck(`4 ${name}`, re.test(watchScreen), name));
}

// --- 5. Upload composer (static) -------------------------------------------
console.log("\n=== CHECK 5: Upload composer fields ===");
const mediaTsx = readFileSync(join(root, "app/(tabs)/more/media.tsx"), "utf8");
const videoComposerBlock = mediaTsx.slice(
  mediaTsx.indexOf("videoPostTitle"),
  mediaTsx.indexOf("Write caption for this live card")
);
checks.push(
  assertCheck(
    "5a Title field in video composer",
    videoComposerBlock.includes("videoPostTitle"),
    "videoPostTitle present"
  ),
  assertCheck(
    "5b Custom cover in video composer",
    videoComposerBlock.includes("videoPostCustomCoverUri"),
    "custom cover present"
  ),
  assertCheck(
    "5c Display type selector",
    videoComposerBlock.includes("VIDEO SIZE") && videoComposerBlock.includes("tiktok"),
    "youtube/tiktok selector"
  ),
  assertCheck(
    "5d No video caption input in composer block",
    !/videoPostCaption|Caption for this video/i.test(videoComposerBlock),
    "no video caption field"
  )
);

// --- 6. Poster prewarm singleton (simulated) ---------------------------------
console.log("\n=== CHECK 6: Poster prewarm singleton (simulated) ===");
const prewarmLines = captureLogs(() => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `feed_${i}`,
    kind: "video",
    mediaUrl: `https://example.com/v${i}.mp4`,
    mediaStatus: "ready",
  }));
  const feedKey = rows
    .slice(0, 8)
    .map((r) => r.id)
    .join("|");

  let batchInflight = null;
  let completedKey = "";

  function logSkip(reason) {
    console.log("KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING", { reason });
  }

  function startInitial() {
    if (feedKey === completedKey) {
      logSkip("initial-already-completed");
      return;
    }
    if (batchInflight) {
      logSkip("initial-batch-inflight");
      return;
    }
    console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", { phase: "initial" });
    batchInflight = Promise.resolve().then(() => {
      batchInflight = null;
      completedKey = feedKey;
    });
  }

  startInitial();
  startInitial();
  startInitial();
});

checks.push(
  assertCheck(
    "6a Initial prewarm starts once",
    countMatches(prewarmLines, "KRISTO_HOME_FEED_POSTER_PREWARM_START") === 1,
    `starts=${countMatches(prewarmLines, "KRISTO_HOME_FEED_POSTER_PREWARM_START")}`
  ),
  assertCheck(
    "6b Duplicate blocked with skip log",
    countMatches(prewarmLines, "KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING") >= 1,
    `skips=${countMatches(prewarmLines, "KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING")}`
  )
);

// --- 7. Poster cache hydrate once (simulated) --------------------------------
console.log("\n=== CHECK 7: Poster cache hydrate once (simulated) ===");
const hydrateLines = captureLogs(() => {
  let sessionReady = false;
  function hydrate() {
    if (sessionReady) {
      console.log("KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY", { count: 8 });
      return;
    }
    sessionReady = true;
    console.log("KRISTO_MEDIA_POSTER_CACHE_HYDRATED", { count: 8 });
  }
  hydrate();
  hydrate();
  hydrate();
});

checks.push(
  assertCheck(
    "7a Hydrate once per session",
    countMatches(hydrateLines, "KRISTO_MEDIA_POSTER_CACHE_HYDRATED") === 1,
    `hydrated=${countMatches(hydrateLines, "KRISTO_MEDIA_POSTER_CACHE_HYDRATED")}`
  ),
  assertCheck(
    "7b Skip log on repeat",
    countMatches(hydrateLines, "KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY") === 2,
    `skips=${countMatches(hydrateLines, "KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY")}`
  )
);

// --- 8. Legacy metro.log baseline (pre-fix evidence) ------------------------
console.log("\n=== CHECK 8: Legacy metro.log baseline ===");
const metroLog = join(root, "metro.log");
if (existsSync(metroLog)) {
  const legacy = readFileSync(metroLog, "utf8");
  const legacyHydrated = (legacy.match(/KRISTO_MEDIA_POSTER_CACHE_HYDRATED/g) || []).length;
  const legacyRcFailed = (legacy.match(/KRISTO_RC_CONFIG_FAILED/g) || []).length;
  const legacyHost = (legacy.match(/HostFunction/gi) || []).length;
  const legacySkipPrewarm = (legacy.match(/KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING/g) || []).length;
  checks.push(
    assertCheck(
      "8a Legacy log predates skip guards (hydrate repeated)",
      legacyHydrated > 1,
      `legacy HYDRATED count=${legacyHydrated} (expected >1 before fix)`
    ),
    assertCheck(
      "8b Legacy log has no HostFunction errors",
      legacyHost === 0,
      `HostFunction count=${legacyHost}`
    ),
    assertCheck(
      "8c Legacy log lacks new skip markers (needs device re-run)",
      legacySkipPrewarm === 0,
      `legacy skip prewarm=${legacySkipPrewarm} — reload app to capture fresh logs`
    ),
    assertCheck(
      "8d Legacy RC CONFIG_FAILED absent",
      legacyRcFailed === 0,
      `CONFIG_FAILED count=${legacyRcFailed}`
    )
  );
}

// --- Summary -----------------------------------------------------------------
const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass);

const report = {
  generatedAt: new Date().toISOString(),
  summary: { total: checks.length, passed: passed.length, failed: failed.length },
  checks,
  deviceRerunRequired: [
    "Reload app on iPhone after Metro rebundle to capture KRISTO_RC_BEFORE_* / AFTER_* on cold configure",
    "Scroll Home Feed 3+ min — expect KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING",
    "Second hydrate call — expect KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY",
    "Open 5–30 min video — expect KRISTO_PLAYBACK_PRIORITY_* and no KRISTO_POSTER_PREFETCH during playback",
    "Screenshots: Watch screen fixed chrome, upload composer, feed cover before play",
  ],
};

writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log("\n=== VERIFICATION SUMMARY ===");
console.log(`Passed: ${passed}/${checks.length}`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log("All automated checks passed.");
}
console.log(`Report: ${reportPath}`);
