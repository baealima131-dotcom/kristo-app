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
import {
  defaultMessagePrivacySettings,
  mergeMessagePrivacySettings,
  normalizeMessagePrivacySettings,
  type MessagePrivacySettingsPatch,
  type MessagePrivacySettingsV1,
} from "@/app/api/_lib/messagePrivacySettings";

neonConfig.fetchConnectionCache = true;

const LOCAL_FILE = "message-privacy-settings.json";

type LocalStore = Record<string, MessagePrivacySettingsV1>;

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

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_message_privacy_settings (
          user_id TEXT PRIMARY KEY,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }
  await schemaReady;
}

async function ensureReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Message privacy settings database not configured");
  }
  if (usePostgres()) {
    await ensureSchema();
  }
}

function normUserId(userId: string) {
  return String(userId || "").trim();
}

/** Returns defaults when no row exists (no backfill of DM threads). */
export async function getMessagePrivacySettings(
  userId: string
): Promise<MessagePrivacySettingsV1> {
  await ensureReady();
  const uid = normUserId(userId);
  if (!uid) return defaultMessagePrivacySettings();

  if (!usePostgres()) {
    const store = await readJsonFile<LocalStore>(LOCAL_FILE, {});
    const row = store[uid];
    if (!row) return defaultMessagePrivacySettings();
    return normalizeMessagePrivacySettings(row);
  }

  const sql = getSql();
  const rows = await sql`
    SELECT settings
    FROM kristo_message_privacy_settings
    WHERE user_id = ${uid}
    LIMIT 1
  `;
  const raw = (rows as { settings: unknown }[])[0]?.settings;
  if (!raw || typeof raw !== "object") {
    return defaultMessagePrivacySettings();
  }
  return normalizeMessagePrivacySettings(raw as Partial<MessagePrivacySettingsV1>);
}

export async function patchMessagePrivacySettings(args: {
  userId: string;
  patch: MessagePrivacySettingsPatch;
}): Promise<MessagePrivacySettingsV1> {
  await ensureReady();
  const uid = normUserId(args.userId);
  if (!uid) {
    throw new Error("userId is required");
  }

  const now = Date.now();
  const current = await getMessagePrivacySettings(uid);
  const next = mergeMessagePrivacySettings(current, args.patch, now);

  if (!usePostgres()) {
    await updateJsonFile<LocalStore>(
      LOCAL_FILE,
      (store) => ({
        ...store,
        [uid]: next,
      }),
      {}
    );
    return next;
  }

  const sql = getSql();
  const payload = JSON.stringify(next);
  await sql`
    INSERT INTO kristo_message_privacy_settings (
      user_id,
      settings,
      updated_at
    )
    VALUES (
      ${uid},
      ${payload}::jsonb,
      NOW()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      settings = EXCLUDED.settings,
      updated_at = NOW()
  `;

  return next;
}
