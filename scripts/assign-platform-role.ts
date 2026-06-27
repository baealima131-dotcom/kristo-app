/**
 * One-time bootstrap for platform roles (System_Admin / Supervisor / Agent).
 * Does NOT touch churchRole — platform roles are stored separately.
 *
 * Local JSON (no DATABASE_URL):
 *   npx tsx scripts/assign-platform-role.ts \
 *     --userId=u_c4fc383d7119a19ee3e8d2b6 \
 *     --platformRole=System_Admin
 *
 * Production Postgres (Vercel / Neon):
 *   vercel env pull .env.production.local --environment=production
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/assign-platform-role.ts \
 *     --userId=u_c4fc383d7119a19ee3e8d2b6 \
 *     --platformRole=System_Admin \
 *     --note="bootstrap system admin"
 *
 * Alternative: run scripts/assign-platform-role.sql in the Neon SQL editor.
 */

import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.join(process.cwd(), ".env.production.local") });
loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env") });

import {
  getPlatformRole,
  resolvePlatformRoleStoreMode,
  upsertPlatformRole,
} from "../app/api/_lib/platformRoles";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, ...rest] = token.slice(2).split("=");
    out[key] = rest.join("=") || "true";
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userId = String(args.userId || "").trim();
  const platformRole = String(args.platformRole || "").trim();
  const note = String(args.note || "assign-platform-role script").trim();

  if (!userId || !platformRole) {
    console.error("Usage: npx tsx scripts/assign-platform-role.ts --userId=... --platformRole=System_Admin [--note=...]");
    process.exit(1);
  }

  const storeMode = resolvePlatformRoleStoreMode();
  console.log("[assign-platform-role] store mode:", storeMode);

  if (storeMode === "missing-db-on-vercel") {
    console.error("DATABASE_URL is not configured on Vercel. Add Postgres env vars first.");
    process.exit(1);
  }

  const saved = await upsertPlatformRole(userId, platformRole, note);
  const verified = await getPlatformRole(userId);

  console.log("[assign-platform-role] saved", saved);
  console.log("[assign-platform-role] verified", { userId, platformRole: verified });

  if (verified !== platformRole) {
    console.error("[assign-platform-role] verification failed");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[assign-platform-role] failed", error);
  process.exit(1);
});
