import { neon, neonConfig } from "@neondatabase/serverless";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

type FeedBlockRecord = {
  id: string;
  blockerUserId: string;
  blockerChurchId: string;
  blockedUserId: string;
  reason?: string;
  createdAt: string;
};

const LOCAL_BLOCKS_FILE = "church-feed-blocks.json";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function blockId() {
  return `fblock_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

function usePostgres() {
  return hasDurableStore();
}

export async function ensureFeedBlockStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Feed block database not configured");
  }
  if (usePostgres()) {
    await ensureFeedBlockSchema();
  }
}

export function isFeedBlockDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("feed block database not configured") ||
    message.includes("database_url not configured")
  );
}

async function ensureFeedBlockSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_feed_blocks (
          id TEXT PRIMARY KEY,
          blocker_user_id TEXT NOT NULL,
          blocker_church_id TEXT NOT NULL DEFAULT '',
          blocked_user_id TEXT NOT NULL,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_church_feed_blocks_unique_pair
        ON kristo_church_feed_blocks (blocker_user_id, blocked_user_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_blocks_blocker_idx
        ON kristo_church_feed_blocks (blocker_user_id, created_at DESC)
      `;
    })();
  }
  await schemaReady;
}

async function readLocalBlocks(): Promise<FeedBlockRecord[]> {
  const rows = await readJsonFile<FeedBlockRecord[]>(LOCAL_BLOCKS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalBlocks(rows: FeedBlockRecord[]) {
  await writeJsonFile(LOCAL_BLOCKS_FILE, rows);
}

export async function listBlockedUserIds(blockerUserId: string): Promise<string[]> {
  await ensureFeedBlockStoreReady();
  const uid = String(blockerUserId || "").trim();
  if (!uid) return [];

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT blocked_user_id
      FROM kristo_church_feed_blocks
      WHERE blocker_user_id = ${uid}
      ORDER BY created_at DESC
    `;
    return (rows as any[])
      .map((row) => String(row.blocked_user_id || "").trim())
      .filter(Boolean);
  }

  const all = await readLocalBlocks();
  return all
    .filter((row) => row.blockerUserId === uid)
    .map((row) => String(row.blockedUserId || "").trim())
    .filter(Boolean);
}

export async function upsertFeedBlock(args: {
  blockerUserId: string;
  blockerChurchId: string;
  blockedUserId: string;
  reason?: string;
}) {
  await ensureFeedBlockStoreReady();

  const blockerUserId = String(args.blockerUserId || "").trim();
  const blockerChurchId = String(args.blockerChurchId || "").trim();
  const blockedUserId = String(args.blockedUserId || "").trim();
  const reason = String(args.reason || "").trim();

  if (!blockerUserId || !blockedUserId) {
    throw new Error("blockerUserId and blockedUserId are required");
  }
  if (blockerUserId === blockedUserId) {
    throw new Error("Cannot block self");
  }

  const row: FeedBlockRecord = {
    id: blockId(),
    blockerUserId,
    blockerChurchId,
    blockedUserId,
    reason: reason || undefined,
    createdAt: nowIso(),
  };

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_church_feed_blocks (
        id, blocker_user_id, blocker_church_id, blocked_user_id, reason, created_at
      ) VALUES (
        ${row.id},
        ${row.blockerUserId},
        ${row.blockerChurchId},
        ${row.blockedUserId},
        ${row.reason || null},
        ${row.createdAt}
      )
      ON CONFLICT (blocker_user_id, blocked_user_id) DO UPDATE SET
        blocker_church_id = EXCLUDED.blocker_church_id,
        reason = EXCLUDED.reason
    `;
    return;
  }

  const all = await readLocalBlocks();
  const existing = all.find(
    (entry) =>
      entry.blockerUserId === blockerUserId &&
      entry.blockedUserId === blockedUserId
  );
  if (existing) {
    existing.blockerChurchId = blockerChurchId;
    existing.reason = reason || undefined;
  } else {
    all.push(row);
  }
  await writeLocalBlocks(all);
}
