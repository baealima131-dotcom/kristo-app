import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const utils = fs.readFileSync(
  path.join(process.cwd(), "apps/mobile/src/components/homeFeed/homeFeedUtils.ts"),
  "utf8"
);
const fnStart = utils.indexOf("export function resolveHomeFeedDisplayAvatar(");
const fn = utils.slice(fnStart, utils.indexOf("\nexport ", fnStart + 10));
const externalSources = fn.slice(fn.indexOf("isExternalVideoAccount\n    ? ["), fn.indexOf(": homeFeedAvatarSourceFields("));

test("external video links use only the creator's own picture", () => {
  assert.ok(externalSources.length > 0);
  assert.match(externalSources, /item\?\.creatorAvatarUrl/);
  assert.match(externalSources, /externalCreatorAvatarCopy\(item\)/);
  // Never the Kristo account (System Admin) that posted the link.
  assert.doesNotMatch(externalSources, /item\?\.authorAvatarUri/);
  assert.doesNotMatch(externalSources, /item\?\.avatarUri\b/);
});

test("with no creator picture the link shows its initial (no cache key, no fallback picture)", () => {
  const ctx = utils.slice(utils.indexOf("export function resolveHomeFeedAvatarCacheContext("));
  assert.match(
    ctx,
    /remoteUris\.length === 0 && String\(item\?\.source \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "system-admin-video-link"[\s\S]{0,200}cacheKey: ""/
  );
});

test("Kristo/church posts keep their own avatar sources", () => {
  assert.match(fn, /: homeFeedAvatarSourceFields\(item, churchMediaFirst\)/);
  const fields = utils.slice(utils.indexOf("function homeFeedAvatarSourceFields("));
  assert.match(fields.slice(0, 2000), /authorAvatarUri/);
  assert.match(fields.slice(0, 2000), /churchAvatarUri/);
});

test("a copy equal to the poster's picture is ignored; a real creator copy is kept", () => {
  const fn2 = utils.slice(utils.indexOf("function externalCreatorAvatarCopy("));
  const body = fn2.slice(0, fn2.indexOf("\n}\n") + 2);
  const run = new Function("item", body.replace(/^function externalCreatorAvatarCopy\(item: any\): string \{/, "").replace(/\n\}\n?$/, ""));
  assert.equal(run({ actorAvatarUri: "/a.jpg", authorAvatarUri: "/a.jpg" }), "");
  assert.equal(run({ actorAvatarUri: "https://yt/c.jpg", authorAvatarUri: "/a.jpg" }), "https://yt/c.jpg");
  assert.equal(run({ actorAvatarUri: "https://yt/c.jpg" }), "https://yt/c.jpg");
  assert.equal(run({}), "");
});

test("normalizer never copies the poster's picture into a video link's creator fields", () => {
  const n = utils.slice(utils.indexOf("export function normalizeHomeFeedApiRow("));
  const block = n.slice(n.indexOf("if (authorAvatar) {"), n.indexOf("if (authorAvatar) {") + 600);
  assert.match(block, /!== "system-admin-video-link"\) \{\n\s+if \(!String\(next\?\.actorAvatarUri/);
});
