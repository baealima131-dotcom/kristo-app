import { neon, neonConfig } from "@neondatabase/serverless";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type ChurchFeedActionType = "hide" | "block";

export type ViewerChurchBlockRecord = {
  id: string;
  viewerUserId: string;
  churchId: string;
  actionType: ChurchFeedActionType;
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

const LOCAL_CHURCH_BLOCKS_FILE = "viewer-church-feed-blocks.json";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function recordId() {
  return `vcb_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function cleanChurchId(raw: unknown) {
  return String(raw || "").trim().toUpperCase();
}

function cleanUserId(raw: unknown) {
  return String(raw || "").trim();
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

export async function ensureFeedChurchBlockStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Church block database not configured");
  }
  if (usePostgres()) {
    await ensureFeedChurchBlockSchema();
  }
}

export function isFeedChurchBlockDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("church block database not configured") ||
    message.includes("database_url not configured")
  );
}

async function ensureFeedChurchBlockSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_viewer_church_blocks (
          id TEXT PRIMARY KEY,
          viewer_user_id TEXT NOT NULL,
          church_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_viewer_church_blocks_unique_pair
        ON kristo_viewer_church_blocks (viewer_user_id, church_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_viewer_church_blocks_viewer_idx
        ON kristo_viewer_church_blocks (viewer_user_id, updated_at DESC)
      `;
    })();
  }
  await schemaReady;
}

async function readLocalRecords(): Promise<ViewerChurchBlockRecord[]> {
  const rows = await readJsonFile<ViewerChurchBlockRecord[]>(LOCAL_CHURCH_BLOCKS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalRecords(rows: ViewerChurchBlockRecord[]) {
  await writeJsonFile(LOCAL_CHURCH_BLOCKS_FILE, rows);
}

export async function listViewerChurchBlocks(
  viewerUserId: string
): Promise<ViewerChurchBlockRecord[]> {
  await ensureFeedChurchBlockStoreReady();
  const uid = cleanUserId(viewerUserId);
  if (!uid) return [];

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id, viewer_user_id, church_id, action_type, reason, created_at, updated_at
      FROM kristo_viewer_church_blocks
      WHERE viewer_user_id = ${uid}
      ORDER BY updated_at DESC
    `;
    return (rows as any[]).map((row) => ({
      id: String(row.id || ""),
      viewerUserId: String(row.viewer_user_id || ""),
      churchId: cleanChurchId(row.church_id),
      actionType: (String(row.action_type || "hide") === "block" ? "block" : "hide") as ChurchFeedActionType,
      reason: String(row.reason || "").trim() || undefined,
      createdAt: String(row.created_at || nowIso()),
      updatedAt: String(row.updated_at || row.created_at || nowIso()),
    }));
  }

  const all = await readLocalRecords();
  return all
    .filter((row) => row.viewerUserId === uid)
    .map((row) => ({ ...row, churchId: cleanChurchId(row.churchId) }))
    .filter((row) => row.churchId);
}

export async function getViewerChurchBlock(
  viewerUserId: string,
  churchId: string
): Promise<ViewerChurchBlockRecord | null> {
  const uid = cleanUserId(viewerUserId);
  const cid = cleanChurchId(churchId);
  if (!uid || !cid) return null;

  const rows = await listViewerChurchBlocks(uid);
  return rows.find((row) => row.churchId === cid) || null;
}

export async function upsertViewerChurchBlock(args: {
  viewerUserId: string;
  churchId: string;
  actionType: ChurchFeedActionType;
  reason?: string;
}) {
  await ensureFeedChurchBlockStoreReady();

  const viewerUserId = cleanUserId(args.viewerUserId);
  const churchId = cleanChurchId(args.churchId);
  const actionType: ChurchFeedActionType = args.actionType === "block" ? "block" : "hide";
  const reason = String(args.reason || "").trim();
  const now = nowIso();

  if (!viewerUserId || !churchId) {
    throw new Error("viewerUserId and churchId are required");
  }

  const row: ViewerChurchBlockRecord = {
    id: recordId(),
    viewerUserId,
    churchId,
    actionType,
    reason: reason || undefined,
    createdAt: now,
    updatedAt: now,
  };

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_viewer_church_blocks (
        id, viewer_user_id, church_id, action_type, reason, created_at, updated_at
      ) VALUES (
        ${row.id},
        ${row.viewerUserId},
        ${row.churchId},
        ${row.actionType},
        ${row.reason || null},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (viewer_user_id, church_id) DO UPDATE SET
        action_type = EXCLUDED.action_type,
        reason = EXCLUDED.reason,
        updated_at = EXCLUDED.updated_at
    `;
    return row;
  }

  const all = await readLocalRecords();
  const existing = all.find(
    (entry) => entry.viewerUserId === viewerUserId && cleanChurchId(entry.churchId) === churchId
  );
  if (existing) {
    existing.actionType = actionType;
    existing.reason = reason || undefined;
    existing.updatedAt = now;
    await writeLocalRecords(all);
    return existing;
  }

  all.push(row);
  await writeLocalRecords(all);
  return row;
}

export async function removeViewerChurchBlock(viewerUserId: string, churchId: string) {
  await ensureFeedChurchBlockStoreReady();

  const uid = cleanUserId(viewerUserId);
  const cid = cleanChurchId(churchId);
  if (!uid || !cid) return false;

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      DELETE FROM kristo_viewer_church_blocks
      WHERE viewer_user_id = ${uid} AND church_id = ${cid}
      RETURNING id
    `;
    return (rows as any[]).length > 0;
  }

  const all = await readLocalRecords();
  const next = all.filter(
    (entry) => !(entry.viewerUserId === uid && cleanChurchId(entry.churchId) === cid)
  );
  if (next.length === all.length) return false;
  await writeLocalRecords(next);
  return true;
}
