/**
 * Ministry media access V1 limit tests.
 * Usage: node scripts/test-ministry-media-access-limit.mjs
 */

import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

function sampleMinistries(churchId, mediaAccessIds) {
  const ids = ["m1", "m2", "m3", "m4", "m5"];
  return ids.map((id, i) => ({
    id,
    churchId,
    name: `Ministry ${i + 1}`,
    mediaAccess: mediaAccessIds.includes(id),
  }));
}

async function testCountHelpers() {
  const mod = await loadTsModule("lib/ministryMediaAccessLimit.ts");
  const churchId = "CH7-TEST";

  const list = sampleMinistries(churchId, ["m1", "m2", "m3"]);
  assert("Counts 3 ministries with media access", mod.countChurchMinistriesWithMediaAccess(list, churchId) === 3);

  assert(
    "Excludes ministry when counting for PATCH enable check",
    mod.countChurchMinistriesWithMediaAccess(list, churchId, "m1") === 2
  );

  assert(
    "wouldExceed blocks 4th enable",
    mod.wouldExceedMinistryMediaAccessLimit({
      ministries: list,
      churchId,
      enablingMediaAccess: true,
    })
  );

  assert(
    "wouldExceed allows enable when excluded ministry already has access",
    !mod.wouldExceedMinistryMediaAccessLimit({
      ministries: list,
      churchId,
      enablingMediaAccess: true,
      excludeMinistryId: "m1",
    })
  );

  assert(
    "wouldExceed blocks 4th when excluded ministry lacks access",
    mod.wouldExceedMinistryMediaAccessLimit({
      ministries: list,
      churchId,
      enablingMediaAccess: true,
      excludeMinistryId: "m4",
    })
  );

  assert(
    "wouldExceed ignores turning off",
    !mod.wouldExceedMinistryMediaAccessLimit({
      ministries: list,
      churchId,
      enablingMediaAccess: false,
    })
  );

  const payload = mod.ministryMediaAccessLimitPayload();
  assert(
    "Payload matches API contract",
    payload.ok === false &&
      payload.code === "MINISTRY_MEDIA_ACCESS_LIMIT_REACHED" &&
      payload.error === "Media access limit reached",
    JSON.stringify(payload)
  );
}

async function testMobileHelper() {
  const mod = await loadTsModule("apps/mobile/src/lib/ministryMediaAccessLimit.ts");

  assert(
    "Mobile detects limit error by code",
    mod.isMinistryMediaAccessLimitReachedError({ ok: false, code: "MINISTRY_MEDIA_ACCESS_LIMIT_REACHED" })
  );

  assert(
    "Mobile counts media access ministries",
    mod.countMinistriesWithMediaAccess([
      { mediaAccess: true },
      { mediaAccess: false },
      { mediaAccess: true },
    ]) === 2
  );
}

async function main() {
  await testCountHelpers();
  await testMobileHelper();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
