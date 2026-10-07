import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./authDb";

let schemaReady: Promise<void> | null = null;
function sqlClient() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("Database unavailable.");
  return neon(url);
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = sqlClient()`CREATE TABLE IF NOT EXISTS soko_deleted_accounts (
      user_id TEXT PRIMARY KEY,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`.then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function isSokoAccountDeleted(userId: string) {
  await ensureSchema();
  const rows = await sqlClient()`SELECT 1 FROM soko_deleted_accounts WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

export async function markSokoAccountDeleted(userId: string) {
  await ensureSchema();
  await sqlClient()`INSERT INTO soko_deleted_accounts (user_id) VALUES (${userId})
    ON CONFLICT (user_id) DO UPDATE SET deleted_at = NOW()`;
}

export async function reactivateSokoAccount(userId: string) {
  await ensureSchema();
  await sqlClient()`DELETE FROM soko_deleted_accounts WHERE user_id = ${userId}`;
}
