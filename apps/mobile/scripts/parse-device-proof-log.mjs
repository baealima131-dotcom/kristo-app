#!/usr/bin/env node
/**
 * Parse device-proof Metro log and score the 8 verification areas.
 * Usage: node scripts/parse-device-proof-log.mjs [logfile]
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logPath = process.argv[2] || join(__dirname, "../device-proof.log");

if (!existsSync(logPath)) {
  console.error(`Missing log: ${logPath}`);
  process.exit(1);
}

const log = readFileSync(logPath, "utf8");
const lines = log.split("\n");

function count(re) {
  const matches = log.match(re);
  return matches ? matches.length : 0;
}

function has(re) {
  return re.test(log);
}

function findAll(re) {
  return lines.filter((l) => re.test(l));
}

const areas = {
  revenueCat: {
    beforeConfigure: count(/KRISTO_RC_BEFORE_CONFIGURE/),
    afterConfigure: count(/KRISTO_RC_AFTER_CONFIGURE/),
    beforeLogin: count(/KRISTO_RC_BEFORE_LOGIN/),
    afterLogin: count(/KRISTO_RC_AFTER_LOGIN/),
    beforeCustomerInfo: count(/KRISTO_RC_BEFORE_CUSTOMER_INFO/),
    afterCustomerInfo: count(/KRISTO_RC_AFTER_CUSTOMER_INFO/),
    configFailed: count(/KRISTO_RC_CONFIG_FAILED/),
    hostFunction: count(/HostFunction/i),
  },
  posterPrewarm: {
    start: count(/KRISTO_HOME_FEED_POSTER_PREWARM_START/),
    skipped: count(/KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING/),
    starts: findAll(/KRISTO_HOME_FEED_POSTER_PREWARM_START/),
  },
  posterCache: {
    hydrated: count(/KRISTO_MEDIA_POSTER_CACHE_HYDRATED/),
    skipped: count(/KRISTO_MEDIA_POSTER_CACHE_HYDRATE_SKIPPED_ALREADY_READY/),
  },
  playbackPriority: {
    active: count(/KRISTO_PLAYBACK_PRIORITY_ACTIVE/),
    paused: count(/KRISTO_PLAYBACK_PRIORITY_PAUSED_JOB/),
    resumed: count(/KRISTO_PLAYBACK_PRIORITY_RESUMED_JOB/),
    posterDuringWatch: 0,
    pollDuringWatch: 0,
    diskDuringWatch: 0,
  },
};

// Detect background job noise while watch modal likely open
let watchOpen = false;
let violations = [];
for (const line of lines) {
  if (/KRISTO_PLAYBACK_PRIORITY_PAUSED_JOB|KRISTO_PLAYBACK_PRIORITY_ACTIVE.*watch-screen-open/.test(line)) {
    watchOpen = true;
  }
  if (/KRISTO_PLAYBACK_PRIORITY_RESUMED_JOB.*watch-screen-closed/.test(line)) {
    watchOpen = false;
  }
  if (!watchOpen) continue;
  if (/KRISTO_HOME_FEED_POSTER_PREWARM_START|KRISTO_POSTER_PREFETCH_START|generateVideoPosterFrame/.test(line)) {
    areas.playbackPriority.posterDuringWatch += 1;
    violations.push(`poster-during-watch: ${line.trim()}`);
  }
  if (/load-feed.*poll|event.*poll/.test(line) && /poll/.test(line)) {
    areas.playbackPriority.pollDuringWatch += 1;
    violations.push(`poll-during-watch: ${line.trim()}`);
  }
  if (/KRISTO_VIDEO_DISK_CACHE|scheduleHomeFeedVideoDiskCache/.test(line)) {
    areas.playbackPriority.diskDuringWatch += 1;
    violations.push(`disk-during-watch: ${line.trim()}`);
  }
}

const checks = [
  ["RC BEFORE_CONFIGURE", areas.revenueCat.beforeConfigure >= 1],
  ["RC AFTER_CONFIGURE", areas.revenueCat.afterConfigure >= 1],
  ["RC BEFORE_LOGIN", areas.revenueCat.beforeLogin >= 1],
  ["RC AFTER_LOGIN", areas.revenueCat.afterLogin >= 1],
  ["RC BEFORE_CUSTOMER_INFO", areas.revenueCat.beforeCustomerInfo >= 1],
  ["RC AFTER_CUSTOMER_INFO", areas.revenueCat.afterCustomerInfo >= 1],
  ["RC no CONFIG_FAILED", areas.revenueCat.configFailed === 0],
  ["RC no HostFunction", areas.revenueCat.hostFunction === 0],
  ["Prewarm START present", areas.posterPrewarm.start >= 1],
  ["Prewarm SKIP on duplicate", areas.posterPrewarm.skipped >= 1],
  ["Cache HYDRATED once", areas.posterCache.hydrated === 1],
  ["Cache HYDRATE SKIP after", areas.posterCache.skipped >= 1],
  ["Playback ACTIVE", areas.playbackPriority.active >= 1],
  ["Playback PAUSED_JOB", areas.playbackPriority.paused >= 1],
  ["Playback RESUMED_JOB", areas.playbackPriority.resumed >= 1],
  ["No poster jobs during watch", areas.playbackPriority.posterDuringWatch === 0],
  ["No disk cache during watch", areas.playbackPriority.diskDuringWatch === 0],
];

console.log(JSON.stringify({ logPath, areas, violations: violations.slice(0, 20) }, null, 2));
console.log("\n=== PASS/FAIL ===");
const failed = [];
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed.push(name);
}
console.log(`\n${checks.filter(([, p]) => p).length}/${checks.length} log checks passed`);
if (failed.length) {
  console.log("Remaining failures:", failed.join(", "));
  process.exitCode = 1;
}
