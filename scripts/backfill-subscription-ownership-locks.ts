/**
 * One-time / maintenance backfill for subscription ownership locks.
 *
 * Scans durable church media profiles with active subscriptions, resolves the
 * authoritative pastor for each church, and creates missing app_store locks via
 * the same cross-church backfill path used by GET /api/church/media.
 *
 * Local JSON (no DATABASE_URL):
 *   npx tsx scripts/backfill-subscription-ownership-locks.ts --dryRun
 *
 * Production Postgres:
 *   vercel env pull .env.production.local --environment=production
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/backfill-subscription-ownership-locks.ts
 *
 * Optional filters:
 *   --ownerUserId=u_abc123
 *   --dryRun
 */

import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.join(process.cwd(), ".env.production.local") });
loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env") });

import { resolveActualChurchPastorUserId } from "../app/api/_lib/churchMediaAccess";
import {
  backfillSubscriptionOwnershipLockFromPastorChurches,
  listAuthoritativePastorMediaProfiles,
} from "../app/api/_lib/subscriptionOwnershipLock";
import { listAllChurchMediaProfiles, resolveMediaStoreMode } from "../app/api/_lib/store/mediaDb";
import { resolveSubscriptionOwnershipLockStoreMode } from "../app/api/_lib/store/subscriptionOwnershipLockDb";
import { isChurchSubscriptionActiveFromRecord } from "../lib/churchSubscription";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, ...rest] = token.slice(2).split("=");
    out[key] = rest.join("=") || "true";
  }
  return out;
}

async function collectPastorUserIds(args: { ownerUserId?: string }) {
  const explicitOwner = String(args.ownerUserId || "").trim();
  if (explicitOwner) return [explicitOwner];

  const pastors = new Set<string>();
  const profiles = await listAllChurchMediaProfiles();

  for (const media of profiles) {
    if (!isChurchSubscriptionActiveFromRecord(media)) continue;
    const churchId = String(media.churchId || "").trim();
    if (!churchId) continue;
    const pastorUserId = String(await resolveActualChurchPastorUserId(churchId)).trim();
    if (!pastorUserId) continue;
    pastors.add(pastorUserId);
  }

  return Array.from(pastors).sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun === "true";
  const ownerUserIdFilter = String(args.ownerUserId || "").trim() || undefined;

  const mediaStoreMode = resolveMediaStoreMode();
  const lockStoreMode = resolveSubscriptionOwnershipLockStoreMode();

  console.log("[backfill-subscription-ownership-locks] media store:", mediaStoreMode);
  console.log("[backfill-subscription-ownership-locks] lock store:", lockStoreMode);
  console.log("[backfill-subscription-ownership-locks] dryRun:", dryRun);

  if (lockStoreMode === "missing-db-on-vercel") {
    console.error("DATABASE_URL is not configured. Add Postgres env vars before running in production.");
    process.exit(1);
  }

  const pastorUserIds = await collectPastorUserIds({ ownerUserId: ownerUserIdFilter });
  console.log("[backfill-subscription-ownership-locks] pastors:", pastorUserIds.length);

  let created = 0;
  let skipped = 0;

  for (const ownerUserId of pastorUserIds) {
    const profiles = await listAuthoritativePastorMediaProfiles(ownerUserId);
    console.log("[backfill-subscription-ownership-locks] pastor", {
      ownerUserId,
      activeProfileCount: profiles.length,
      churchIds: profiles.map((media) => media.churchId),
    });

    const lock = await backfillSubscriptionOwnershipLockFromPastorChurches({
      ownerUserId,
      trigger: "migration",
      dryRun,
    });

    if (dryRun) {
      continue;
    }

    if (lock) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  console.log("[backfill-subscription-ownership-locks] done", {
    pastors: pastorUserIds.length,
    created,
    skipped,
    dryRun,
  });
}

main().catch((error) => {
  console.error("[backfill-subscription-ownership-locks] failed", error);
  process.exit(1);
});
