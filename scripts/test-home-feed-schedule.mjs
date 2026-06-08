/**
 * Focused Home Feed schedule tests (run before commit).
 * Usage: node scripts/test-home-feed-schedule.mjs
 */

import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const VIEWER_CHURCH = "CH7-EQIZVQ";
const OTHER_CHURCH = "CH7-M2IMWP";

const results = [];
const capturedLogs = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function assert(name, condition, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

async function loadTsModule(relativePath) {
  const full = path.join(root, relativePath);
  return import(pathToFileURL(full).href);
}

function captureLifecycleLogs(fn) {
  const originalLog = console.log;
  console.log = (...args) => {
    const key = args[0];
    if (
      key === "KRISTO_HOME_FEED_SCHEDULE_CREATED" ||
      key === "KRISTO_HOME_FEED_SCHEDULE_EXPIRED" ||
      key === "KRISTO_HOME_FEED_SCHEDULE_REMOVED" ||
      key === "KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_HIDDEN"
    ) {
      capturedLogs.push({ event: key, payload: args[1] });
    }
    originalLog(...args);
  };
  try {
    return fn();
  } finally {
    console.log = originalLog;
  }
}

function formatClock(ms) {
  const d = new Date(ms);
  let hour = d.getHours();
  const minute = String(d.getMinutes()).padStart(2, "0");
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${meridiem}`;
}

function formatMeetingDay(ms) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function buildUpcomingSlot(nowMs, id = "slot-1") {
  const startMs = nowMs + 2 * 60 * 60 * 1000;
  const endMs = startMs + 45 * 60 * 1000;
  return {
    id,
    name: "MC Opening",
    slotLabel: "Slot 1",
    meetingDay: formatMeetingDay(startMs),
    startTime: formatClock(startMs),
    endTime: formatClock(endMs),
    durationMin: 45,
    status: "open",
  };
}

function buildExpiredSlot(nowMs, id = "slot-expired") {
  const endMs = nowMs - 5 * 60 * 1000;
  const startMs = endMs - 30 * 60 * 1000;
  return {
    id,
    name: "Ended Slot",
    slotLabel: "Slot 1",
    meetingDay: formatMeetingDay(startMs),
    startTime: formatClock(startMs),
    endTime: formatClock(endMs),
    durationMin: 30,
    status: "open",
  };
}

function buildScheduleRow(scheduleId, churchId, slots, extra = {}) {
  return {
    id: scheduleId,
    churchId,
    source: "media-schedule",
    scheduleType: "media-live-slots",
    scheduleSlots: slots,
    ...extra,
  };
}

function isHomeFeedScheduleCardRow(row) {
  const source = String(row?.source || "").toLowerCase();
  const scheduleType = String(row?.scheduleType || "").toLowerCase();
  return source.includes("media-schedule") || scheduleType.includes("media-live-slots");
}

function homeFeedRowChurchId(row) {
  return String(row?.churchId || "").trim();
}

function filterSameChurchHomeFeedScheduleRows(rows, viewerChurchId) {
  const viewerCid = String(viewerChurchId || "").trim();
  if (!viewerCid) return rows;

  return rows.filter((row) => {
    if (!isHomeFeedScheduleCardRow(row)) return true;
    const rowCid = homeFeedRowChurchId(row);
    if (!rowCid || rowCid === viewerCid) return true;

    console.log("KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_HIDDEN", {
      viewerChurchId: viewerCid,
      scheduleChurchId: rowCid,
      scheduleId: String(row?.parentScheduleId || row?.sourceScheduleId || row?.id || ""),
      reason: "cross_church_claim_slot_v1",
    });
    return false;
  });
}

async function testLifecycleLogging() {
  const mod = await loadTsModule("lib/homeFeedScheduleLifecycle.ts");
  capturedLogs.length = 0;

  captureLifecycleLogs(() => {
    mod.logHomeFeedScheduleCreated({
      scheduleId: "sched-test",
      churchId: VIEWER_CHURCH,
      slotCount: 2,
      source: "media-schedule",
    });
    mod.logHomeFeedScheduleExpired({
      scheduleId: "sched-test",
      churchId: VIEWER_CHURCH,
      reason: "all_slots_expired",
      endedAt: new Date().toISOString(),
    });
    mod.logHomeFeedScheduleRemoved({
      scheduleId: "sched-test",
      churchId: VIEWER_CHURCH,
      source: "api_filterHomeFeedRenderableRows",
    });
  });

  assert(
    "KRISTO_HOME_FEED_SCHEDULE_CREATED logged",
    capturedLogs.some(
      (l) => l.event === "KRISTO_HOME_FEED_SCHEDULE_CREATED" && l.payload?.source === "media-schedule"
    )
  );
  assert(
    "KRISTO_HOME_FEED_SCHEDULE_EXPIRED logged",
    capturedLogs.some((l) => l.event === "KRISTO_HOME_FEED_SCHEDULE_EXPIRED")
  );
  assert(
    "KRISTO_HOME_FEED_SCHEDULE_REMOVED logged",
    capturedLogs.some((l) => l.event === "KRISTO_HOME_FEED_SCHEDULE_REMOVED")
  );
}

async function testScheduleLifecycleAndVisibility() {
  const lock = await loadTsModule("lib/mediaScheduleLock.ts");
  const lifecycle = await loadTsModule("lib/homeFeedScheduleLifecycle.ts");
  const nowMs = Date.now();

  const churchLiveRow = buildScheduleRow("sched-clc", VIEWER_CHURCH, [buildUpcomingSlot(nowMs, "clc-slot")], {
    ministryId: "ministry-clc",
    roomId: "room-clc",
  });
  const ministryRow = buildScheduleRow("sched-ministry", VIEWER_CHURCH, [buildUpcomingSlot(nowMs, "min-slot")], {
    ministryId: "ministry-live-1",
    roomId: "room-ministry",
  });
  const expiredRow = buildScheduleRow("sched-expired", VIEWER_CHURCH, [buildExpiredSlot(nowMs)]);

  assert(
    "Church Live Control schedule has active room slots",
    !lock.areAllScheduleSlotsExpired(churchLiveRow, nowMs),
    `active=${lock.getActiveScheduleSlots(churchLiveRow, nowMs).length}`
  );
  assert(
    "Ministry schedule has active room slots",
    !lock.areAllScheduleSlotsExpired(ministryRow, nowMs),
    `active=${lock.getActiveScheduleSlots(ministryRow, nowMs).length}`
  );

  const sameChurchActive = lock.getActiveScheduleSlots(churchLiveRow, nowMs);
  assert(
    "Same-church member can see claim slots",
    sameChurchActive.length > 0 && sameChurchActive.every((slot) => lock.isActiveScheduleSlot(slot, nowMs)),
    `slots=${sameChurchActive.length}`
  );

  capturedLogs.length = 0;
  captureLifecycleLogs(() => {
    const rows = [churchLiveRow, buildScheduleRow("sched-other", OTHER_CHURCH, [buildUpcomingSlot(nowMs, "other")])];
    const filtered = filterSameChurchHomeFeedScheduleRows(rows, VIEWER_CHURCH);
    assert(
      "Cross-church schedule hidden from viewer",
      filtered.length === 1 && filtered[0].id === "sched-clc"
    );
  });
  assert(
    "KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_HIDDEN logged",
    capturedLogs.some(
      (l) =>
        l.event === "KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_HIDDEN" &&
        l.payload?.scheduleChurchId === OTHER_CHURCH
    )
  );

  capturedLogs.length = 0;
  captureLifecycleLogs(() => {
    lifecycle.logHomeFeedScheduleExpired({
      scheduleId: "sched-expired",
      churchId: VIEWER_CHURCH,
      reason: "all_slots_expired",
      endedAt: new Date(nowMs - 5 * 60 * 1000).toISOString(),
    });
    lifecycle.logHomeFeedScheduleRemoved({
      scheduleId: "sched-expired",
      churchId: VIEWER_CHURCH,
      source: "cache_reconcile",
    });
  });

  assert(
    "Expired schedule detected for Home Feed removal",
    lock.areAllScheduleSlotsExpired(expiredRow, nowMs)
  );
  assert(
    "Expired schedule has zero active slots",
    lock.getActiveScheduleSlots(expiredRow, nowMs).length === 0
  );
}

async function testToolWiringAndCacheCleanup() {
  const toolPath = path.join(
    root,
    "apps/mobile/app/kingdom/church-project-tool/[assignmentId]/[tool].tsx"
  );
  const apiPath = path.join(root, "apps/mobile/src/components/homeFeed/homeFeedApi.ts");
  const feedPath = path.join(root, "app/api/church/feed/route.ts");
  const toolSrc = fs.readFileSync(toolPath, "utf8");
  const apiSrc = fs.readFileSync(apiPath, "utf8");
  const feedSrc = fs.readFileSync(feedPath, "utf8");

  assert(
    "Church Live Control does not publish to Home Feed",
    !toolSrc.includes('source: "church-live-control"'),
    "church-live-control home feed source still present"
  );
  assert(
    "Church Live Control uses room schedule batch only",
    toolSrc.includes("publishScheduleSlotsBatch") &&
      toolSrc.includes('sourceParam === "church-live-control"'),
    "missing room-only church live control markers"
  );
  assert(
    "Ministry live does not publish to Home Feed",
    !/if\s*\(\s*isMinistryLiveSchedule\s*\)\s*\{[\s\S]*publishScheduleBatchToHomeFeed/.test(toolSrc),
    "ministry-live still wired to home feed publish"
  );
  assert(
    "Ministry uses room schedule batch only",
    toolSrc.includes("publishScheduleSlotsBatch") && toolSrc.includes("isMinistryLiveSchedule"),
    "missing ministry room schedule path"
  );
  assert(
    "Media schedule publishes to Home Feed",
    toolSrc.includes("isMediaSchedule && !isMinistryLiveSchedule") &&
      toolSrc.includes("publishScheduleBatchToHomeFeed"),
    "media home feed publish wiring missing"
  );
  assert(
    "publishScheduleBatchToHomeFeed helper exists",
    fs.existsSync(path.join(root, "apps/mobile/src/lib/homeFeedSchedulePublish.ts"))
  );
  assert(
    "Cache reconcile logs schedule removal",
    apiSrc.includes("logHomeFeedScheduleRemoved") && apiSrc.includes("cache_reconcile")
  );
  assert(
    "API feed filter removes expired schedules",
    feedSrc.includes("areAllScheduleSlotsExpired") && feedSrc.includes("logHomeFeedScheduleExpired")
  );
}

async function main() {
  console.log("\n=== Home Feed schedule tests ===\n");

  try {
    await testLifecycleLogging();
    await testScheduleLifecycleAndVisibility();
    await testToolWiringAndCacheCleanup();
  } catch (e) {
    fail("Tests threw", String(e?.message || e));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  if (failed.length) {
    console.error("Failed:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main();
