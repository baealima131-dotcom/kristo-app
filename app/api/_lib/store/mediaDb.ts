import { neon, neonConfig } from "@neondatabase/serverless";

import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type ChurchMediaProfile = {
  id: string;
  churchId: string;
  ownerUserId: string;
  mediaName: string;
  category?: string;
  subCategory?: string;
  language?: string;
  country?: string;
  targetAudience?: string;
  contentStyle?: string;
  bio?: string;
  tags?: string[];
  hosts?: any[];
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

const STORE_FILE = "church-media.json";

type MediaRow = {
  church_id: string;
  owner_user_id: string;
  data: ChurchMediaProfile;
  created_at: string;
  updated_at: string | null;
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

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

export function resolveMediaStoreMode(): "postgres" | "local-json" | "missing-db-on-vercel" {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function ensureMediaStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Media database not configured");
  }
  if (usePostgres()) {
    await ensureMediaSchema();
  }
}

async function ensureMediaSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_media (
          church_id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_media_owner_idx
        ON kristo_church_media (LOWER(owner_user_id))
      `;
    })();
  }
  await schemaReady;
}

function rowToMedia(row: MediaRow): ChurchMediaProfile {
  const data = row.data && typeof row.data === "object" ? row.data : ({} as ChurchMediaProfile);
  return {
    ...data,
    id: data.id || `church-media-${row.church_id}`,
    churchId: row.church_id,
    ownerUserId: row.owner_user_id || data.ownerUserId,
    mediaName: String(data.mediaName || ""),
    createdAt: Number(data.createdAt || Date.parse(row.created_at) || Date.now()),
    updatedAt: Number(data.updatedAt || Date.parse(String(row.updated_at || "")) || Date.now()),
  };
}

async function readLocalStore(): Promise<Record<string, ChurchMediaProfile>> {
  return readJsonFile<Record<string, ChurchMediaProfile>>(STORE_FILE, {});
}

async function writeLocalStore(store: Record<string, ChurchMediaProfile>) {
  await writeJsonFile(STORE_FILE, store);
}

async function getLocalByChurchId(churchId: string): Promise<ChurchMediaProfile | null> {
  const store = await readLocalStore();
  return Object.values(store).find((m) => String(m.churchId || "") === churchId) || null;
}

export async function getChurchMediaByChurchId(churchId: string): Promise<ChurchMediaProfile | null> {
  const id = String(churchId || "").trim();
  if (!id) return null;

  if (usePostgres()) {
    await ensureMediaSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT church_id, owner_user_id, data, created_at, updated_at
      FROM kristo_church_media
      WHERE church_id = ${id}
      LIMIT 1
    `;
    const row = (rows as MediaRow[])[0];
    return row ? rowToMedia(row) : null;
  }

  return getLocalByChurchId(id);
}

export async function upsertChurchMedia(input: {
  churchId: string;
  ownerUserId: string;
  patch: Partial<ChurchMediaProfile> & { mediaName: string };
}): Promise<ChurchMediaProfile> {
  const churchId = String(input.churchId || "").trim();
  const ownerUserId = String(input.ownerUserId || "").trim();
  if (!churchId) throw new Error("churchId required");
  if (!ownerUserId) throw new Error("ownerUserId required");

  const existing = await getChurchMediaByChurchId(churchId);
  const now = Date.now();
  const id = existing?.id || `church-media-${churchId}`;

  const next: ChurchMediaProfile = {
    ...(existing || {}),
    ...input.patch,
    id,
    churchId,
    ownerUserId: existing?.ownerUserId || ownerUserId,
    mediaName: String(input.patch.mediaName || existing?.mediaName || "").trim(),
    tags: Array.isArray(input.patch.tags)
      ? input.patch.tags.map((x) => String(x || "").trim()).filter(Boolean)
      : existing?.tags || [],
    hosts: Array.isArray(input.patch.hosts) ? input.patch.hosts : existing?.hosts || [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (usePostgres()) {
    await ensureMediaSchema();
    const sql = getSql();
    await sql`
      INSERT INTO kristo_church_media (church_id, owner_user_id, data, created_at, updated_at)
      VALUES (${churchId}, ${next.ownerUserId}, ${next as any}, NOW(), NOW())
      ON CONFLICT (church_id)
      DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        data = EXCLUDED.data,
        updated_at = NOW()
    `;
    return next;
  }

  const store = await readLocalStore();
  store[id] = next;
  await writeLocalStore(store);
  return next;
}

export async function patchChurchMediaSubscription(
  churchId: string,
  patch: { subscriptionActive: boolean; subscriptionPlan?: string }
): Promise<ChurchMediaProfile | null> {
  const existing = await getChurchMediaByChurchId(churchId);
  if (!existing) return null;

  const now = Date.now();
  return upsertChurchMedia({
    churchId,
    ownerUserId: existing.ownerUserId,
    patch: {
      ...existing,
      mediaName: existing.mediaName,
      subscriptionActive: patch.subscriptionActive,
      subscriptionPlan: patch.subscriptionPlan || existing.subscriptionPlan,
      subscriptionUpdatedAt: now,
    },
  });
}

export function isMediaDatabaseError(error: unknown) {
  const msg = String((error as any)?.message || error || "");
  return msg.includes("DATABASE_URL not configured") || msg.includes("Media database not configured");
}
