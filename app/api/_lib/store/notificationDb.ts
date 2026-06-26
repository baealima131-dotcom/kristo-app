import { neon, neonConfig } from "@neondatabase/serverless";

import type { AppNotification } from "@/app/api/_lib/notifications";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import {
  matchesNotificationStoreScope,
  type NotificationStoreScope,
} from "@/app/api/_lib/notificationScope";

neonConfig.fetchConnectionCache = true;

const LOCAL_NOTIFICATIONS_FILE = "notifications.json";

type NotificationRow = {
  id: string;
  church_id: string;
  type: string;
  title: string;
  message: string | null;
  actor_name: string | null;
  actor_user_id: string | null;
  actor_avatar_uri: string | null;
  actor_role: string | null;
  ministry_id: string | null;
  ministry_member_id: string | null;
  target_user_id: string | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
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

function nowIso() {
  return new Date().toISOString();
}

function newNotificationId(prefix = "ntf") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function rowToNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    churchId: row.church_id,
    type: row.type as AppNotification["type"],
    title: row.title,
    message: row.message ?? undefined,
    actorName: row.actor_name ?? undefined,
    actorUserId: row.actor_user_id ?? undefined,
    actorAvatarUri: row.actor_avatar_uri ?? undefined,
    actorRole: row.actor_role ?? undefined,
    ministryId: row.ministry_id ?? undefined,
    ministryMemberId: row.ministry_member_id ?? undefined,
    targetUserId: row.target_user_id ?? undefined,
    isRead: !!row.is_read,
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : undefined,
  };
}

function sortAndLimit(items: AppNotification[], limit: number): AppNotification[] {
  return items
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, Math.max(1, limit));
}

export type NotificationStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveNotificationStoreMode(): NotificationStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function ensureNotificationStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Notification database not configured");
  }
  if (usePostgres()) {
    await ensureNotificationSchema();
  }
}

async function ensureNotificationSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_notifications (
          id TEXT PRIMARY KEY,
          church_id TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT,
          actor_name TEXT,
          actor_user_id TEXT,
          actor_avatar_uri TEXT,
          actor_role TEXT,
          ministry_id TEXT,
          ministry_member_id TEXT,
          target_user_id TEXT,
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          read_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_notifications_church_target_idx
        ON kristo_notifications (church_id, target_user_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_notifications_church_unread_idx
        ON kristo_notifications (church_id, is_read)
      `;
    })();
  }
  await schemaReady;
}

async function readLocalNotifications(): Promise<AppNotification[]> {
  const rows = await readJsonFile<AppNotification[]>(LOCAL_NOTIFICATIONS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

export type CreateNotificationInput = Omit<AppNotification, "id" | "createdAt" | "isRead"> & {
  id?: string;
};

export async function dbGetNotificationById(id: string): Promise<AppNotification | null> {
  const notificationId = String(id || "").trim();
  if (!notificationId) return null;
  await ensureNotificationStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT id, church_id, type, title, message,
             actor_name, actor_user_id, actor_avatar_uri, actor_role,
             ministry_id, ministry_member_id, target_user_id,
             is_read, created_at, read_at
      FROM kristo_notifications
      WHERE id = ${notificationId}
      LIMIT 1
    `;
    const row = (rows as NotificationRow[])[0];
    return row ? rowToNotification(row) : null;
  }

  const all = await readLocalNotifications();
  return all.find((n) => n.id === notificationId) ?? null;
}

export async function dbCreateNotification(
  input: CreateNotificationInput
): Promise<AppNotification> {
  await ensureNotificationStoreReady();

  const requestedId = String(input.id || "").trim();
  const notificationId = requestedId || newNotificationId();

  if (requestedId) {
    const existing = await dbGetNotificationById(notificationId);
    if (existing) return existing;
  }

  const n: AppNotification = {
    ...input,
    id: notificationId,
    createdAt: nowIso(),
    isRead: false,
  };

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_notifications (
        id, church_id, type, title, message,
        actor_name, actor_user_id, actor_avatar_uri, actor_role,
        ministry_id, ministry_member_id, target_user_id,
        is_read, created_at, read_at
      ) VALUES (
        ${n.id},
        ${n.churchId},
        ${n.type},
        ${n.title},
        ${n.message ?? null},
        ${n.actorName ?? null},
        ${n.actorUserId ?? null},
        ${n.actorAvatarUri ?? null},
        ${n.actorRole ?? null},
        ${n.ministryId ?? null},
        ${n.ministryMemberId ?? null},
        ${n.targetUserId ?? null},
        ${n.isRead},
        ${n.createdAt},
        ${n.readAt ?? null}
      )
    `;
    return n;
  }

  await updateJsonFile<AppNotification[]>(
    LOCAL_NOTIFICATIONS_FILE,
    (current) => [...(Array.isArray(current) ? current : []), n],
    []
  );
  return n;
}

export async function dbListNotifications(args: {
  churchId: string;
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
  storeScope?: NotificationStoreScope;
}): Promise<AppNotification[]> {
  const { churchId, userId, unreadOnly, limit = 50, storeScope = "inbox" } = args;
  await ensureNotificationStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows = unreadOnly
      ? storeScope === "forMe"
        ? await sql`
            SELECT id, church_id, type, title, message,
                   actor_name, actor_user_id, actor_avatar_uri, actor_role,
                   ministry_id, ministry_member_id, target_user_id,
                   is_read, created_at, read_at
            FROM kristo_notifications
            WHERE church_id = ${churchId}
              AND is_read = FALSE
              AND target_user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT ${Math.max(1, limit)}
          `
        : storeScope === "churchAdmin"
          ? await sql`
              SELECT id, church_id, type, title, message,
                     actor_name, actor_user_id, actor_avatar_uri, actor_role,
                     ministry_id, ministry_member_id, target_user_id,
                     is_read, created_at, read_at
              FROM kristo_notifications
              WHERE church_id = ${churchId}
                AND is_read = FALSE
                AND target_user_id IS NULL
              ORDER BY created_at DESC
              LIMIT ${Math.max(1, limit)}
            `
          : await sql`
              SELECT id, church_id, type, title, message,
                     actor_name, actor_user_id, actor_avatar_uri, actor_role,
                     ministry_id, ministry_member_id, target_user_id,
                     is_read, created_at, read_at
              FROM kristo_notifications
              WHERE church_id = ${churchId}
                AND is_read = FALSE
                AND (target_user_id IS NULL OR target_user_id = ${userId})
              ORDER BY created_at DESC
              LIMIT ${Math.max(1, limit)}
            `
      : storeScope === "forMe"
        ? await sql`
            SELECT id, church_id, type, title, message,
                   actor_name, actor_user_id, actor_avatar_uri, actor_role,
                   ministry_id, ministry_member_id, target_user_id,
                   is_read, created_at, read_at
            FROM kristo_notifications
            WHERE church_id = ${churchId}
              AND target_user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT ${Math.max(1, limit)}
          `
        : storeScope === "churchAdmin"
          ? await sql`
              SELECT id, church_id, type, title, message,
                     actor_name, actor_user_id, actor_avatar_uri, actor_role,
                     ministry_id, ministry_member_id, target_user_id,
                     is_read, created_at, read_at
              FROM kristo_notifications
              WHERE church_id = ${churchId}
                AND target_user_id IS NULL
              ORDER BY created_at DESC
              LIMIT ${Math.max(1, limit)}
            `
          : await sql`
              SELECT id, church_id, type, title, message,
                     actor_name, actor_user_id, actor_avatar_uri, actor_role,
                     ministry_id, ministry_member_id, target_user_id,
                     is_read, created_at, read_at
              FROM kristo_notifications
              WHERE church_id = ${churchId}
                AND (target_user_id IS NULL OR target_user_id = ${userId})
              ORDER BY created_at DESC
              LIMIT ${Math.max(1, limit)}
            `;

    return (rows as NotificationRow[]).map(rowToNotification);
  }

  const all = await readLocalNotifications();
  return sortAndLimit(
    all
      .filter((n) => n.churchId === churchId)
      .filter((n) => matchesNotificationStoreScope(n, userId, storeScope))
      .filter((n) => (unreadOnly ? !n.isRead : true)),
    limit
  );
}

export async function dbCountNotifications(args: {
  churchId: string;
  userId: string;
  unreadOnly?: boolean;
  storeScope?: NotificationStoreScope;
}): Promise<number> {
  const { churchId, userId, unreadOnly = true, storeScope = "inbox" } = args;
  await ensureNotificationStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows =
      storeScope === "forMe"
        ? unreadOnly
          ? await sql`
              SELECT COUNT(*)::int AS count
              FROM kristo_notifications
              WHERE church_id = ${churchId}
                AND is_read = FALSE
                AND target_user_id = ${userId}
            `
          : await sql`
              SELECT COUNT(*)::int AS count
              FROM kristo_notifications
              WHERE church_id = ${churchId}
                AND target_user_id = ${userId}
            `
        : storeScope === "churchAdmin"
          ? unreadOnly
            ? await sql`
                SELECT COUNT(*)::int AS count
                FROM kristo_notifications
                WHERE church_id = ${churchId}
                  AND is_read = FALSE
                  AND target_user_id IS NULL
              `
            : await sql`
                SELECT COUNT(*)::int AS count
                FROM kristo_notifications
                WHERE church_id = ${churchId}
                  AND target_user_id IS NULL
              `
          : unreadOnly
            ? await sql`
                SELECT COUNT(*)::int AS count
                FROM kristo_notifications
                WHERE church_id = ${churchId}
                  AND is_read = FALSE
                  AND (target_user_id IS NULL OR target_user_id = ${userId})
              `
            : await sql`
                SELECT COUNT(*)::int AS count
                FROM kristo_notifications
                WHERE church_id = ${churchId}
                  AND (target_user_id IS NULL OR target_user_id = ${userId})
              `;
    return Number((rows as { count: number }[])[0]?.count || 0);
  }

  const all = await readLocalNotifications();
  return all
    .filter((n) => n.churchId === churchId)
    .filter((n) => matchesNotificationStoreScope(n, userId, storeScope))
    .filter((n) => (unreadOnly ? !n.isRead : true)).length;
}

export async function dbSetRead(id: string, isRead: boolean): Promise<AppNotification | null> {
  const notificationId = String(id || "").trim();
  if (!notificationId) return null;
  await ensureNotificationStoreReady();

  const readAt = isRead ? nowIso() : undefined;

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      UPDATE kristo_notifications
      SET is_read = ${!!isRead},
          read_at = ${readAt ?? null}
      WHERE id = ${notificationId}
      RETURNING id, church_id, type, title, message,
                actor_name, actor_user_id, actor_avatar_uri, actor_role,
                ministry_id, ministry_member_id, target_user_id,
                is_read, created_at, read_at
    `;
    const row = (rows as NotificationRow[])[0];
    return row ? rowToNotification(row) : null;
  }

  let updated: AppNotification | null = null;
  await updateJsonFile<AppNotification[]>(
    LOCAL_NOTIFICATIONS_FILE,
    (current) => {
      const items = Array.isArray(current) ? current : [];
      return items.map((n) => {
        if (n.id !== notificationId) return n;
        updated = {
          ...n,
          isRead: !!isRead,
          readAt,
        };
        return updated;
      });
    },
    []
  );
  return updated;
}

export async function dbRemoveNotification(id: string): Promise<AppNotification | null> {
  const notificationId = String(id || "").trim();
  if (!notificationId) return null;
  await ensureNotificationStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      DELETE FROM kristo_notifications
      WHERE id = ${notificationId}
      RETURNING id, church_id, type, title, message,
                actor_name, actor_user_id, actor_avatar_uri, actor_role,
                ministry_id, ministry_member_id, target_user_id,
                is_read, created_at, read_at
    `;
    const row = (rows as NotificationRow[])[0];
    return row ? rowToNotification(row) : null;
  }

  let removed: AppNotification | null = null;
  await updateJsonFile<AppNotification[]>(
    LOCAL_NOTIFICATIONS_FILE,
    (current) => {
      const items = Array.isArray(current) ? current : [];
      const idx = items.findIndex((n) => n.id === notificationId);
      if (idx < 0) return items;
      removed = items[idx];
      const next = items.slice();
      next.splice(idx, 1);
      return next;
    },
    []
  );
  return removed;
}

export async function dbMarkAllRead(args: {
  churchId: string;
  userId: string;
  storeScope?: NotificationStoreScope;
}): Promise<{ updated: number }> {
  const { churchId, userId, storeScope = "inbox" } = args;
  await ensureNotificationStoreReady();
  const readAt = nowIso();

  if (usePostgres()) {
    const sql = getSql();
    const rows =
      storeScope === "forMe"
        ? await sql`
            UPDATE kristo_notifications
            SET is_read = TRUE,
                read_at = ${readAt}
            WHERE church_id = ${churchId}
              AND is_read = FALSE
              AND target_user_id = ${userId}
            RETURNING id
          `
        : storeScope === "churchAdmin"
          ? await sql`
              UPDATE kristo_notifications
              SET is_read = TRUE,
                  read_at = ${readAt}
              WHERE church_id = ${churchId}
                AND is_read = FALSE
                AND target_user_id IS NULL
              RETURNING id
            `
          : await sql`
              UPDATE kristo_notifications
              SET is_read = TRUE,
                  read_at = ${readAt}
              WHERE church_id = ${churchId}
                AND is_read = FALSE
                AND (target_user_id IS NULL OR target_user_id = ${userId})
              RETURNING id
            `;
    return { updated: (rows as { id: string }[]).length };
  }

  let updated = 0;
  await updateJsonFile<AppNotification[]>(
    LOCAL_NOTIFICATIONS_FILE,
    (current) => {
      const items = Array.isArray(current) ? current : [];
      return items.map((n) => {
        if (n.churchId !== churchId) return n;
        if (!matchesNotificationStoreScope(n, userId, storeScope)) return n;
        if (n.isRead) return n;
        updated += 1;
        return { ...n, isRead: true, readAt };
      });
    },
    []
  );
  return { updated };
}
