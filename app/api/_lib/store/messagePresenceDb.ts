import { neon, neonConfig } from "@neondatabase/serverless";
import {
  getDatabaseUrl,
  hasDurableStore,
  isVercelRuntime,
} from "@/app/api/_lib/store/authDb";
import {
  readJsonFile,
  updateJsonFile,
} from "@/app/api/_lib/store/fs";

neonConfig.fetchConnectionCache = true;

const LOCAL_FILE = "message-presence.json";
const LOCAL_TYPING_FILE = "message-typing.json";

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

type PresenceStore = Record<string, Record<string, number>>;
type TypingStore = Record<string, Record<string, number>>;

const TYPING_TTL_MS = 6_000;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_message_presence (
          context_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          last_seen_at BIGINT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (context_key, user_id)
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_message_presence_user_idx
        ON kristo_message_presence (user_id, last_seen_at DESC)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_message_typing (
          room_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          typing_until BIGINT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (room_id, user_id)
        )
      `;
    })();
  }

  await schemaReady;
}

async function ensureReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Message presence database not configured");
  }

  if (hasDurableStore()) {
    await ensureSchema();
  }
}

export async function touchMessagePresence(
  contextKey: string,
  userId: string,
  now: number
): Promise<void> {
  await ensureReady();

  if (!hasDurableStore()) {
    await updateJsonFile<PresenceStore>(
      LOCAL_FILE,
      (store) => ({
        ...store,
        [contextKey]: {
          ...(store[contextKey] || {}),
          [userId]: now,
        },
      }),
      {}
    );
    return;
  }

  const sql = getSql();

  await sql`
    INSERT INTO kristo_message_presence (
      context_key,
      user_id,
      last_seen_at,
      updated_at
    )
    VALUES (
      ${contextKey},
      ${userId},
      ${now},
      NOW()
    )
    ON CONFLICT (context_key, user_id)
    DO UPDATE SET
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW()
  `;
}

export async function getMessagePresenceLastSeen(
  targetUserId: string,
  contextKeys: string[]
): Promise<number> {
  await ensureReady();

  const keys = Array.from(
    new Set(contextKeys.map((v) => String(v || "").trim()).filter(Boolean))
  );

  if (!keys.length || !targetUserId) return 0;

  if (!hasDurableStore()) {
    const store = await readJsonFile<PresenceStore>(LOCAL_FILE, {});

    return Math.max(
      0,
      ...keys.map((key) => Number(store?.[key]?.[targetUserId] || 0))
    );
  }

  const sql = getSql();

  const rows = await sql`
    SELECT MAX(last_seen_at)::bigint AS last_seen_at
    FROM kristo_message_presence
    WHERE user_id = ${targetUserId}
      AND context_key = ANY(${keys}::text[])
  `;

  return Number((rows as any[])?.[0]?.last_seen_at || 0);
}

export async function touchMessageTyping(
  roomId: string,
  userId: string,
  now = Date.now()
): Promise<void> {
  await ensureReady();
  const rid = String(roomId || "").trim();
  const uid = String(userId || "").trim();
  if (!rid || !uid) return;

  const typingUntil = now + TYPING_TTL_MS;

  if (!hasDurableStore()) {
    await updateJsonFile<TypingStore>(
      LOCAL_TYPING_FILE,
      (store) => ({
        ...store,
        [rid]: {
          ...(store[rid] || {}),
          [uid]: typingUntil,
        },
      }),
      {}
    );
    return;
  }

  const sql = getSql();
  await sql`
    INSERT INTO kristo_message_typing (
      room_id,
      user_id,
      typing_until,
      updated_at
    )
    VALUES (
      ${rid},
      ${uid},
      ${typingUntil},
      NOW()
    )
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET
      typing_until = EXCLUDED.typing_until,
      updated_at = NOW()
  `;
}

export async function isUserTypingInRoom(
  roomId: string,
  userId: string,
  now = Date.now()
): Promise<boolean> {
  await ensureReady();
  const rid = String(roomId || "").trim();
  const uid = String(userId || "").trim();
  if (!rid || !uid) return false;

  if (!hasDurableStore()) {
    const store = await readJsonFile<TypingStore>(LOCAL_TYPING_FILE, {});
    return Number(store?.[rid]?.[uid] || 0) > now;
  }

  const sql = getSql();
  const rows = await sql`
    SELECT typing_until
    FROM kristo_message_typing
    WHERE room_id = ${rid}
      AND user_id = ${uid}
      AND typing_until > ${now}
    LIMIT 1
  `;
  return Boolean((rows as any[])?.[0]);
}
