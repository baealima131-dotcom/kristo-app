import { neon, neonConfig } from "@neondatabase/serverless";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

type ModerationEvent = {
  id: string;
  eventType: "report_post" | "block_user" | "hide_church" | "block_church" | "report_church";
  actorUserId: string;
  actorChurchId?: string;
  targetPostId?: string;
  targetUserId?: string;
  targetChurchId?: string;
  reason?: string;
  details?: string;
  createdAt: string;
};

const LOCAL_MODERATION_EVENTS_FILE = "church-moderation-events.json";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function eventId() {
  return `fmod_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
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

export async function ensureModerationEventsStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Moderation events database not configured");
  }
  if (usePostgres()) {
    await ensureModerationEventsSchema();
  }
}

async function ensureModerationEventsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_moderation_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          actor_church_id TEXT,
          target_post_id TEXT,
          target_user_id TEXT,
          target_church_id TEXT,
          reason TEXT,
          details TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        ALTER TABLE kristo_moderation_events
        ADD COLUMN IF NOT EXISTS target_church_id TEXT
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_moderation_events_created_idx
        ON kristo_moderation_events (created_at DESC)
      `;
    })();
  }
  await schemaReady;
}

async function readLocalModerationEvents(): Promise<ModerationEvent[]> {
  const rows = await readJsonFile<ModerationEvent[]>(LOCAL_MODERATION_EVENTS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalModerationEvents(rows: ModerationEvent[]) {
  await writeJsonFile(LOCAL_MODERATION_EVENTS_FILE, rows);
}

export async function createModerationEvent(input: {
  eventType: ModerationEvent["eventType"];
  actorUserId: string;
  actorChurchId?: string;
  targetPostId?: string;
  targetUserId?: string;
  targetChurchId?: string;
  reason?: string;
  details?: string;
}) {
  await ensureModerationEventsStoreReady();

  const row: ModerationEvent = {
    id: eventId(),
    eventType: input.eventType,
    actorUserId: String(input.actorUserId || "").trim(),
    actorChurchId: String(input.actorChurchId || "").trim() || undefined,
    targetPostId: String(input.targetPostId || "").trim() || undefined,
    targetUserId: String(input.targetUserId || "").trim() || undefined,
    targetChurchId: String(input.targetChurchId || "").trim().toUpperCase() || undefined,
    reason: String(input.reason || "").trim() || undefined,
    details: String(input.details || "").trim() || undefined,
    createdAt: nowIso(),
  };

  if (!row.actorUserId) {
    throw new Error("actorUserId is required");
  }

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_moderation_events (
        id, event_type, actor_user_id, actor_church_id, target_post_id, target_user_id, target_church_id, reason, details, created_at
      ) VALUES (
        ${row.id},
        ${row.eventType},
        ${row.actorUserId},
        ${row.actorChurchId || null},
        ${row.targetPostId || null},
        ${row.targetUserId || null},
        ${row.targetChurchId || null},
        ${row.reason || null},
        ${row.details || null},
        ${row.createdAt}
      )
    `;
    return row.id;
  }

  const all = await readLocalModerationEvents();
  all.push(row);
  await writeLocalModerationEvents(all);
  return row.id;
}
