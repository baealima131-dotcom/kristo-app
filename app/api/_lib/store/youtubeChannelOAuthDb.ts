import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { neon, neonConfig } from "@neondatabase/serverless";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!hasDurableStore()) {
    if (isVercelRuntime()) throw new Error("YouTube analytics storage is not configured.");
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured.");
  }
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured.");
    sqlClient = neon(url);
  }
  return sqlClient;
}

export function hashYoutubeOAuthValue(value: string) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function encryptionKey() {
  const secret = String(process.env.KRISTO_SESSION_SECRET || "").trim();
  if (!secret) throw new Error("YouTube analytics encryption is not configured.");
  return createHash("sha256").update(secret).digest();
}

function encryptRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptRefreshToken(value: string) {
  const [ivPart, tagPart, cipherPart] = String(value || "").split(".");
  if (!ivPart || !tagPart || !cipherPart) throw new Error("Stored YouTube connection is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(cipherPart, "base64url")), decipher.final()]).toString("utf8");
}

export async function ensureYoutubeOAuthSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_youtube_analytics_invites (
          token_hash TEXT PRIMARY KEY,
          video_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          creator_name TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_youtube_analytics_oauth_states (
          state_hash TEXT PRIMARY KEY,
          invite_token_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_youtube_channel_connections (
          channel_id TEXT PRIMARY KEY,
          channel_title TEXT NOT NULL DEFAULT '',
          refresh_token_cipher TEXT NOT NULL,
          connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }
  await schemaReady;
}

export async function createYoutubeAnalyticsInvite(input: {
  tokenHash: string;
  videoId: string;
  channelId: string;
  creatorName: string;
  createdBy: string;
  expiresAt: string;
}) {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  await sql`
    INSERT INTO kristo_youtube_analytics_invites
      (token_hash, video_id, channel_id, creator_name, created_by, expires_at)
    VALUES
      (${input.tokenHash}, ${input.videoId}, ${input.channelId}, ${input.creatorName}, ${input.createdBy}, ${input.expiresAt})
  `;
}

export async function getYoutubeAnalyticsInvite(tokenHash: string) {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT token_hash, video_id, channel_id, creator_name, created_by, expires_at, used_at
    FROM kristo_youtube_analytics_invites
    WHERE token_hash = ${tokenHash}
      AND expires_at > NOW()
      AND used_at IS NULL
    LIMIT 1
  `;
  return (rows as any[])[0] || null;
}

export async function createYoutubeOAuthState(stateHash: string, inviteTokenHash: string) {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  await sql`
    INSERT INTO kristo_youtube_analytics_oauth_states (state_hash, invite_token_hash, expires_at)
    VALUES (${stateHash}, ${inviteTokenHash}, NOW() + INTERVAL '10 minutes')
  `;
}

export async function consumeYoutubeOAuthState(stateHash: string) {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  const rows = await sql`
    DELETE FROM kristo_youtube_analytics_oauth_states
    WHERE state_hash = ${stateHash} AND expires_at > NOW()
    RETURNING invite_token_hash
  `;
  return String((rows as any[])?.[0]?.invite_token_hash || "");
}

export async function completeYoutubeAnalyticsInvite(input: {
  tokenHash: string;
  channelId: string;
  channelTitle: string;
  refreshToken: string;
}) {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  const inviteRows = await sql`
    UPDATE kristo_youtube_analytics_invites
    SET used_at = NOW()
    WHERE token_hash = ${input.tokenHash}
      AND channel_id = ${input.channelId}
      AND expires_at > NOW()
      AND used_at IS NULL
    RETURNING channel_id
  `;
  if (!(inviteRows as any[]).length) return false;

  await sql`
    INSERT INTO kristo_youtube_channel_connections
      (channel_id, channel_title, refresh_token_cipher)
    VALUES
      (${input.channelId}, ${input.channelTitle}, ${encryptRefreshToken(input.refreshToken)})
    ON CONFLICT (channel_id)
    DO UPDATE SET
      channel_title = EXCLUDED.channel_title,
      refresh_token_cipher = EXCLUDED.refresh_token_cipher,
      connected_at = NOW(),
      updated_at = NOW()
  `;
  return true;
}

export async function listConnectedYoutubeChannelIds() {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  const rows = await sql`SELECT channel_id FROM kristo_youtube_channel_connections ORDER BY channel_title`;
  return (rows as any[]).map((row) => String(row.channel_id || "")).filter(Boolean);
}

export async function getYoutubeChannelConnections() {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  const rows = await sql`SELECT channel_id, channel_title, refresh_token_cipher FROM kristo_youtube_channel_connections`;
  return (rows as any[]).map((row) => ({
    channelId: String(row.channel_id || ""),
    channelTitle: String(row.channel_title || ""),
    refreshToken: decryptRefreshToken(String(row.refresh_token_cipher || "")),
  }));
}

export async function removeYoutubeChannelConnection(channelId: string) {
  await ensureYoutubeOAuthSchema();
  const sql = getSql();
  await sql`DELETE FROM kristo_youtube_channel_connections WHERE channel_id = ${channelId}`;
}
