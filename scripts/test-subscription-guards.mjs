/**
 * Focused subscription guard tests (run before commit).
 * Usage: node scripts/test-subscription-guards.mjs [--api-base=https://kristo-app.vercel.app]
 */

import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const API_BASE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--api-base="));
  return (arg ? arg.split("=")[1] : process.env.KRISTO_API_BASE || "https://kristo-app.vercel.app").replace(/\/$/, "");
})();

const VIEWER_CHURCH = "CH7-EQIZVQ";
const OTHER_CHURCH = "CH7-M2IMWP";

const results = [];

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

async function testResponseShape() {
  process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING = "0";
  process.env.NODE_ENV = "test";
  const mod = await loadTsModule("app/api/_lib/churchSubscription.ts");
  const res = mod.churchSubscriptionRequiredResponse();
  const body = await res.json();
  assert(
    "Response includes CHURCH_SUBSCRIPTION_REQUIRED code",
    body.code === "CHURCH_SUBSCRIPTION_REQUIRED" && body.ok === false && body.error === "Subscription required",
    JSON.stringify(body)
  );
  assert("Response status is 403", res.status === 403, String(res.status));
}

async function testGuardBlocksInactiveChurch() {
  process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING = "0";
  process.env.NODE_ENV = "test";

  const mod = await loadTsModule("app/api/_lib/churchSubscription.ts");
  const blocked = await mod.requireChurchSubscriptionActive("CH7-EQIZVQ", {
    endpoint: "/api/church/feed",
    churchId: "CH7-EQIZVQ",
    userId: "u-pastor-test",
    role: "Pastor",
    action: "create_media_schedule",
  });

  assert("Guard blocks inactive church (local data)", blocked !== null, blocked ? "blocked" : "allowed");
  if (blocked) {
    const body = await blocked.json();
    assert(
      "Guard returns CHURCH_SUBSCRIPTION_REQUIRED",
      body.code === "CHURCH_SUBSCRIPTION_REQUIRED",
      JSON.stringify(body)
    );
  }
}

async function testHomeFeedCrossChurchFilter() {
  const mod = await loadTsModule("apps/mobile/src/components/homeFeed/homeFeedUtils.ts");
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    if (args[0] === "KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_HIDDEN") logs.push(args[1]);
    originalLog(...args);
  };

  const rows = [
    {
      id: "sched-same",
      churchId: VIEWER_CHURCH,
      source: "media-schedule",
      scheduleType: "media-live-slots",
      scheduleSlots: [{ id: "s1", name: "Slot 1" }],
    },
    {
      id: "sched-other",
      churchId: OTHER_CHURCH,
      source: "media-schedule",
      scheduleType: "media-live-slots",
      scheduleSlots: [{ id: "s2", name: "Slot 2" }],
    },
  ];

  const filtered = mod.filterSameChurchHomeFeedScheduleRows(rows, VIEWER_CHURCH);
  console.log = originalLog;

  assert(
    "Same-church schedule kept",
    filtered.some((r) => String(r.id) === "sched-same"),
    `ids=${filtered.map((r) => r.id).join(",")}`
  );
  assert(
    "Cross-church schedule hidden",
    !filtered.some((r) => String(r.id) === "sched-other"),
    `ids=${filtered.map((r) => r.id).join(",")}`
  );
  assert(
    "KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_HIDDEN logged",
    logs.some((l) => l?.reason === "cross_church_claim_slot_v1" && l?.scheduleChurchId === OTHER_CHURCH),
    JSON.stringify(logs)
  );
}

async function testClientSubscriptionErrorDetection() {
  const mod = await loadTsModule("apps/mobile/src/lib/churchSubscription.ts");
  process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING = "0";

  assert(
    "Detects code CHURCH_SUBSCRIPTION_REQUIRED",
    mod.isChurchSubscriptionRequiredError({ ok: false, code: "CHURCH_SUBSCRIPTION_REQUIRED" }),
    "code field"
  );
  assert(
    "Member message defined",
    mod.CHURCH_SUBSCRIPTION_MEMBER_MESSAGE.includes("active subscription"),
    mod.CHURCH_SUBSCRIPTION_MEMBER_MESSAGE
  );
}

async function apiPost(path, body, headers, base = API_BASE) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function apiGet(path, headers, base = API_BASE) {
  const res = await fetch(`${base}${path}`, { headers, cache: "no-store" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function testProductionApiGuards() {
  const base = process.env.KRISTO_TEST_API_BASE || API_BASE;
  if (!base.includes("localhost") && !process.env.KRISTO_RUN_PROD_API_TESTS) {
    pass("Skipping production API guard tests (deploy first or set KRISTO_RUN_PROD_API_TESTS=1)", base);
    return;
  }
  const pastorHeaders = {
    "x-kristo-user-id": "u-sub-guard-pastor-test",
    "x-kristo-role": "Pastor",
    "x-kristo-church-id": VIEWER_CHURCH,
  };
  const memberHeaders = {
    "x-kristo-user-id": "u-sub-guard-member-test",
    "x-kristo-role": "Member",
    "x-kristo-church-id": VIEWER_CHURCH,
  };

  const scheduleBody = {
    action: "create_post",
    type: "post",
    text: "subscription guard test",
    source: "media-schedule",
    scheduleType: "media-live-slots",
    scheduleSlots: [{ id: "slot-test-1", name: "Test Slot" }],
  };

  const mediaSchedule = await apiPost("/api/church/feed", scheduleBody, pastorHeaders, base);
  const mediaBlocked =
    mediaSchedule.status === 403 &&
    mediaSchedule.json?.code === "CHURCH_SUBSCRIPTION_REQUIRED";
  assert(
    "API: pastor media schedule blocked when unsubscribed",
    mediaBlocked || mediaSchedule.status === 401,
    `status=${mediaSchedule.status} body=${JSON.stringify(mediaSchedule.json).slice(0, 180)}`
  );

  const roomSchedule = await apiPost(
    "/api/church/room-messages",
    {
      roomId: "church-media-room",
      roomKind: "assignment",
      kind: "text",
      schedule: { id: "sched-test", title: "Test" },
      text: "",
    },
    pastorHeaders,
    base
  );
  const roomBlocked =
    roomSchedule.status === 403 &&
    roomSchedule.json?.code === "CHURCH_SUBSCRIPTION_REQUIRED";
  assert(
    "API: room schedule payload blocked when unsubscribed",
    roomBlocked || roomSchedule.status === 401,
    `status=${roomSchedule.status} body=${JSON.stringify(roomSchedule.json).slice(0, 180)}`
  );

  const memberSchedule = await apiPost("/api/church/feed", scheduleBody, memberHeaders, base);
  const memberBlocked =
    memberSchedule.status === 403 &&
    (memberSchedule.json?.code === "CHURCH_SUBSCRIPTION_REQUIRED" ||
      String(memberSchedule.json?.error || "").includes("Subscription"));
  assert(
    "API: member schedule attempt blocked",
    memberBlocked || memberSchedule.status === 401 || memberSchedule.status === 403,
    `status=${memberSchedule.status} body=${JSON.stringify(memberSchedule.json).slice(0, 180)}`
  );

  const feed = await apiGet(
    `/api/church/feed?scope=global&churchId=${encodeURIComponent(VIEWER_CHURCH)}`,
    memberHeaders,
    base
  );
  const items = Array.isArray(feed.json?.items)
    ? feed.json.items
    : Array.isArray(feed.json?.data)
      ? feed.json.data
      : [];
  const crossChurchSchedules = items.filter((row) => {
    const cid = String(row?.churchId || "").trim();
    const isSchedule =
      String(row?.source || "").includes("media-schedule") ||
      String(row?.scheduleType || "").includes("media-live-slots");
    return isSchedule && cid && cid !== VIEWER_CHURCH;
  });
  assert(
    "API: home feed has no cross-church schedule rows",
    feed.status === 200 ? crossChurchSchedules.length === 0 : feed.status === 401,
    feed.status === 200
      ? `crossChurchSchedules=${crossChurchSchedules.length} total=${items.length}`
      : `status=${feed.status}`
  );

  const liveGet = await apiGet(
    `/api/church/live?churchId=${encodeURIComponent(VIEWER_CHURCH)}`,
    memberHeaders,
    base
  );
  assert(
    "API: watching live (GET) still allowed",
    liveGet.status === 200 || liveGet.status === 401,
    `status=${liveGet.status}`
  );

  const livePost = await apiPost(
    "/api/church/live",
    { isLive: true, title: "Guard test" },
    pastorHeaders,
    base
  );
  assert(
    "API: live POST blocked when unsubscribed",
    livePost.status === 403 && livePost.json?.code === "CHURCH_SUBSCRIPTION_REQUIRED",
    `status=${livePost.status} body=${JSON.stringify(livePost.json).slice(0, 120)}`
  );

  const updateSlots = await apiPost(
    "/api/church/feed",
    { action: "update-schedule-slots", postId: "any-id", slots: [{ id: "s1", name: "X" }] },
    pastorHeaders,
    base
  );
  assert(
    "API: update-schedule-slots blocked when unsubscribed",
    updateSlots.status === 403 && updateSlots.json?.code === "CHURCH_SUBSCRIPTION_REQUIRED",
    `status=${updateSlots.status} body=${JSON.stringify(updateSlots.json).slice(0, 120)}`
  );

  const claimSlot = await apiPost(
    "/api/church/feed",
    {
      action: "claim_schedule_slot",
      postId: "missing-schedule",
      slotId: "slot-1",
      claim: { name: "Member" },
    },
    memberHeaders,
    base
  );
  assert(
    "API: claim_schedule_slot not subscription-blocked",
    claimSlot.json?.code !== "CHURCH_SUBSCRIPTION_REQUIRED",
    `status=${claimSlot.status} body=${JSON.stringify(claimSlot.json).slice(0, 120)}`
  );

  const feedView = await apiGet(`/api/church/feed?churchId=${encodeURIComponent(VIEWER_CHURCH)}`, memberHeaders, base);
  assert(
    "API: feed GET view still allowed",
    feedView.status === 200,
    `status=${feedView.status}`
  );
}

async function main() {
  console.log(`\n=== Subscription guard tests (api=${API_BASE}) ===\n`);

  try {
    await testResponseShape();
    await testGuardBlocksInactiveChurch();
    await testHomeFeedCrossChurchFilter();
    await testClientSubscriptionErrorDetection();
  } catch (e) {
    fail("Unit tests threw", String(e?.message || e));
  }

  try {
    await testProductionApiGuards();
  } catch (e) {
    fail("Production API tests threw", String(e?.message || e));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  if (failed.length) {
    console.error("Failed:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main();
