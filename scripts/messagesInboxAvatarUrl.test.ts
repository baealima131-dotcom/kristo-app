import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const mobile = (p: string) => fs.readFileSync(path.join(process.cwd(), "apps/mobile", p), "utf8");

test("DM rows give <Image> a loadable avatar URL (server paths joined with the API base)", () => {
  const api = mobile("src/lib/directMessagesApi.ts");
  assert.match(api, /function directMessageAvatarUrl\(row: any\): string \{\s*return homeFeedMediaUrl\(row\?\.avatarUri \|\| row\?\.avatarUrl \|\| ""\);/);
  // Every avatar field mapped from the API goes through it (inbox, thread open, peer preview).
  assert.doesNotMatch(api, /String\(row\?\.avatarUri \|\| row\?\.avatarUrl \|\| ""\)/);
  assert.doesNotMatch(api, /String\(row\?\.avatarUrl \|\| row\?\.avatarUri \|\| ""\)/);
  assert.equal((api.match(/directMessageAvatarUrl\(row\)/g) || []).length, 4);
});
