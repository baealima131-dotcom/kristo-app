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
  subscriptionExpiresAt?: number;
  subscriptionSource?: "app_store" | "stripe" | "offline_activation" | "backend_activation";
  subscriptionActivatedAt?: number;
  offlineActivationCode?: string;
  offlineActivationBatchId?: string;
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

function normalizeChurchId(churchId: string) {
  return String(churchId || "").trim();
}

function isRecordStore(value: unknown): value is Record<string, ChurchMediaProfile> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readLocalStore(): Promise<Record<string, ChurchMediaProfile>> {
  const raw = await readJsonFile<unknown>(STORE_FILE, {});

  if (Array.isArray(raw)) {
    console.warn("[MediaDb] repairing corrupt church-media.json array store", {
      length: raw.length,
    });
    const migrated: Record<string, ChurchMediaProfile> = {};
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const profile = item as ChurchMediaProfile;
      const churchId = normalizeChurchId(profile.churchId);
      const id = String(profile.id || (churchId ? `church-media-${churchId}` : "")).trim();
      if (!churchId || !String(profile.mediaName || "").trim()) continue;
      migrated[id] = {
        ...profile,
        id,
        churchId,
        mediaName: String(profile.mediaName || "").trim(),
      };
    }
    await writeJsonFile(STORE_FILE, migrated);
    return migrated;
  }

  if (!isRecordStore(raw)) {
    console.warn("[MediaDb] repairing invalid church-media.json store shape");
    await writeJsonFile(STORE_FILE, {});
    return {};
  }

  return raw;
}

async function writeLocalStore(store: Record<string, ChurchMediaProfile>) {
  if (!isRecordStore(store)) {
    throw new Error("Invalid church media store payload");
  }

  await writeJsonFile(STORE_FILE, store);
  const readBack = await readJsonFile<unknown>(STORE_FILE, null);

  if (!isRecordStore(readBack)) {
    throw new Error("Church media store write verification failed");
  }

  const expectedKeys = Object.keys(store);
  for (const key of expectedKeys) {
    const expectedName = String(store[key]?.mediaName || "").trim();
    const actualName = String(readBack[key]?.mediaName || "").trim();
    if (expectedName && actualName !== expectedName) {
      throw new Error("Church media store write verification mismatch");
    }
  }
}

async function getLocalByChurchId(churchId: string): Promise<ChurchMediaProfile | null> {
  const cid = normalizeChurchId(churchId);
  if (!cid) return null;

  const store = await readLocalStore();
  const target = cid.toUpperCase();
  return (
    Object.values(store).find(
      (media) => normalizeChurchId(media.churchId).toUpperCase() === target
    ) || null
  );
}

export async function confirmChurchMediaPersisted(
  churchId: string,
  expectedMediaName?: string
): Promise<ChurchMediaProfile | null> {
  const media = await getChurchMediaByChurchId(churchId);
  const mediaName = String(media?.mediaName || "").trim();
  const ok =
    !!mediaName &&
    (!expectedMediaName || mediaName === String(expectedMediaName || "").trim());

  if (ok && media) {
    console.log("KRISTO_MEDIA_BACKEND_CONFIRMED", {
      churchId: normalizeChurchId(churchId),
      mediaId: media.id,
      mediaName: media.mediaName,
      hostCount: Array.isArray(media.hosts) ? media.hosts.length : 0,
      storeMode: resolveMediaStoreMode(),
    });
  }

  return ok ? media : null;
}

function normalizeOwnerUserId(ownerUserId: string) {
  return String(ownerUserId || "").trim();
}

export async function listChurchMediaByOwnerUserId(
  ownerUserId: string
): Promise<ChurchMediaProfile[]> {
  const uid = normalizeOwnerUserId(ownerUserId);
  if (!uid) return [];

  if (usePostgres()) {
    await ensureMediaSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT church_id, owner_user_id, data, created_at, updated_at
      FROM kristo_church_media
      WHERE LOWER(owner_user_id) = LOWER(${uid})
      ORDER BY updated_at DESC
    `) as MediaRow[];
    return rows
      .map(rowToMedia)
      .filter((media) => Boolean(String(media.mediaName || "").trim()));
  }

  const store = await readLocalStore();
  const target = uid.toUpperCase();
  return Object.values(store).filter(
    (media) =>
      normalizeOwnerUserId(media.ownerUserId).toUpperCase() === target &&
      Boolean(String(media.mediaName || "").trim())
  );
}

export async function listAllChurchMediaProfiles(): Promise<ChurchMediaProfile[]> {
  if (usePostgres()) {
    await ensureMediaSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT church_id, owner_user_id, data, created_at, updated_at
      FROM kristo_church_media
      ORDER BY updated_at DESC
    `) as MediaRow[];
    return rows
      .map(rowToMedia)
      .filter((media) => Boolean(String(media.mediaName || "").trim()));
  }

  const store = await readLocalStore();
  return Object.values(store).filter((media) =>
    Boolean(String(media.mediaName || "").trim())
  );
}

export async function getChurchMediaByChurchId(churchId: string): Promise<ChurchMediaProfile | null> {
  const id = normalizeChurchId(churchId);
  if (!id) return null;

  if (usePostgres()) {
    await ensureMediaSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT church_id, owner_user_id, data, created_at, updated_at
      FROM kristo_church_media
      WHERE LOWER(church_id) = LOWER(${id})
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
  const churchId = normalizeChurchId(input.churchId);
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

  if (!existing && input.patch.subscriptionActive !== true) {
    next.subscriptionActive = false;
    delete next.subscriptionPlan;
    delete next.subscriptionUpdatedAt;
    delete next.subscriptionExpiresAt;
  }

  if (!next.mediaName) {
    throw new Error("mediaName required");
  }

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
  } else {
    const store = await readLocalStore();
    store[id] = next;
    await writeLocalStore(store);
  }

  const confirmed = await confirmChurchMediaPersisted(churchId, next.mediaName);
  if (!confirmed?.mediaName) {
    throw new Error("Failed to persist church media profile");
  }

  console.log("KRISTO_MEDIA_PROFILE_PERSISTED", {
    churchId,
    mediaId: confirmed.id,
    mediaName: confirmed.mediaName,
    hostCount: Array.isArray(confirmed.hosts) ? confirmed.hosts.length : 0,
    subscriptionActive: confirmed.subscriptionActive ?? false,
    subscriptionPlan: confirmed.subscriptionPlan ?? null,
    subscriptionUpdatedAt: confirmed.subscriptionUpdatedAt ?? null,
    storeMode: resolveMediaStoreMode(),
  });

  return confirmed;
}

export async function patchChurchMediaSubscription(
  churchId: string,
  patch: {
    subscriptionActive: boolean;
    subscriptionPlan?: string | null;
    subscriptionExpiresAt?: number | null;
    subscriptionSource?: ChurchMediaProfile["subscriptionSource"] | null;
  }
): Promise<ChurchMediaProfile | null> {
  const existing = await getChurchMediaByChurchId(churchId);
  if (!existing) return null;

  const now = Date.now();
  const nextPatch: Partial<ChurchMediaProfile> = {
    ...existing,
    mediaName: existing.mediaName,
    subscriptionActive: patch.subscriptionActive,
    subscriptionUpdatedAt: patch.subscriptionActive ? now : undefined,
  };

  if (patch.subscriptionPlan !== undefined) {
    if (patch.subscriptionPlan) {
      nextPatch.subscriptionPlan = patch.subscriptionPlan;
    } else {
      delete nextPatch.subscriptionPlan;
    }
  } else if (!patch.subscriptionActive) {
    delete nextPatch.subscriptionPlan;
  }

  if (patch.subscriptionExpiresAt !== undefined) {
    if (patch.subscriptionExpiresAt === null) {
      delete nextPatch.subscriptionExpiresAt;
    } else {
      nextPatch.subscriptionExpiresAt = patch.subscriptionExpiresAt;
    }
  } else if (!patch.subscriptionActive) {
    delete nextPatch.subscriptionExpiresAt;
  }

  if (patch.subscriptionSource !== undefined) {
    if (patch.subscriptionSource) {
      nextPatch.subscriptionSource = patch.subscriptionSource;
    } else {
      delete nextPatch.subscriptionSource;
    }
  }

  if (!patch.subscriptionActive) {
    delete nextPatch.subscriptionUpdatedAt;
  }

  return upsertChurchMedia({
    churchId,
    ownerUserId: existing.ownerUserId,
    patch: nextPatch as Partial<ChurchMediaProfile> & { mediaName: string },
  });
}

export function isMediaDatabaseError(error: unknown) {
  const msg = String((error as any)?.message || error || "");
  return msg.includes("DATABASE_URL not configured") || msg.includes("Media database not configured");
}
