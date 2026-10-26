/**
 * Seed the local review backend with test accounts (from a JSON file kept
 * outside git) and two test churches. Refuses anything but the local adapter.
 *   source .review-tools/review-env.sh
 *   REVIEW_ACCOUNTS=.review-tools/secrets/test-accounts.json \
 *   node --import ./scripts/_testlib/aliasLoader.mjs scripts/_testlib/seedReviewUi.ts
 */
import fs from "node:fs";

if (!/^http:\/\/127\.0\.0\.1:\d+\/sql$/.test(String(process.env.KRISTO_REVIEW_LOCAL_NEON_HTTP_ENDPOINT || ""))) {
  throw new Error("Refusing to seed: not pointed at the local review database adapter");
}
const { seedChurches, seedUsers } = await import("./programFixtures.ts");
const accounts = JSON.parse(fs.readFileSync(String(process.env.REVIEW_ACCOUNTS), "utf8"));
await seedChurches([
  { id: "CH7-RVHOME", name: "Review Home Church (test)" },
  { id: "CH7-RVONE", name: "Review Church One (test)" },
  { id: "CH7-RVTWO", name: "Review Church Two (test)" },
]);
await seedUsers(accounts);
console.log("seeded", accounts.map((a: { email: string }) => a.email).join(", "));
process.exit(0);
