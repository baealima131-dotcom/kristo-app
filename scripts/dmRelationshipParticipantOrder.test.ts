import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "app/api/_lib/store/directMessageRelationshipDb.ts"), "utf8");

test("relationship insert orders the pair in SQL (same collation as the ordered check)", () => {
  const insert = src.slice(src.indexOf("INSERT INTO kristo_direct_message_relationships ("));
  const values = insert.slice(insert.indexOf("VALUES ("), insert.indexOf("ON CONFLICT"));
  assert.match(values, /LEAST\(\$\{ordered\[0\]\}::text, \$\{ordered\[1\]\}::text\)/);
  assert.match(values, /GREATEST\(\$\{ordered\[0\]\}::text, \$\{ordered\[1\]\}::text\)/);
  // The JavaScript order alone must not decide participant_a / participant_b.
  assert.doesNotMatch(values, /\$\{ordered\[0\]\},\s*\n\s*\$\{ordered\[1\]\},/);
});

test("the ordered-pair constraint and unique pair index are unchanged", () => {
  assert.match(src, /CONSTRAINT kristo_dm_rel_participants_ordered\s*\n\s*CHECK \(participant_a < participant_b\)/);
  assert.match(src, /CREATE UNIQUE INDEX IF NOT EXISTS kristo_dm_rel_participants_uidx\s*\n\s*ON kristo_direct_message_relationships \(participant_a, participant_b\)/);
});

test("JavaScript and non-C collations can disagree, which is why SQL orders the pair", () => {
  // JS (UTF-16 code units): "-" (45) < "_" (95), so "u-demo-1" sorts first; en_US.UTF-8 ignores
  // punctuation at the first level and puts "u_2c93..." first ("2" < "d").
  assert.ok("u-demo-1" < "u_2c93f5c95ab561a1f23da440");
});
