import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./authDb";
import { getSokoProductById } from "./sokoProductsDb";
import { getProfile } from "@/app/api/auth/_lib/profile";
import {
  cleanCommentBody,
  RATE_LIMITS,
  type ShareKind,
} from "@/app/api/_lib/sokoEngagementPolicy";
import {
  claimOpenProductReport,
  consumeEngagementRateLimit,
  ensureProductReportOpenedEvent,
  readOpenProductReportSlot,
  syncSnapshotOpenFlag,
  type OpenProductReportSlot,
} from "@/app/api/_lib/sokoReportPersistence";

type Sql = ReturnType<typeof sqlClient>;

let ready: Promise<void> | null = null;

function sqlClient() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("Database unavailable.");
  return neon(url);
}

export async function ensureSokoEngagementSchema() {
  if (!ready) {
    ready = (async () => {
      const sql = sqlClient();
      await sql`CREATE TABLE IF NOT EXISTS soko_product_likes (
        product_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, user_id)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS soko_product_saves (
        product_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, user_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS soko_product_saves_user_idx
        ON soko_product_saves (user_id, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS soko_product_comments (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'visible'
          CHECK (status IN ('visible', 'hidden', 'deleted')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        moderated_at TIMESTAMPTZ,
        moderated_by_user_id TEXT,
        moderated_by_role TEXT,
        moderation_reason TEXT
      )`;
      await sql`ALTER TABLE soko_product_comments ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`;
      await sql`ALTER TABLE soko_product_comments ADD COLUMN IF NOT EXISTS moderated_by_user_id TEXT`;
      await sql`ALTER TABLE soko_product_comments ADD COLUMN IF NOT EXISTS moderated_by_role TEXT`;
      await sql`ALTER TABLE soko_product_comments ADD COLUMN IF NOT EXISTS moderation_reason TEXT`;
      await sql`CREATE TABLE IF NOT EXISTS soko_product_comment_moderation_events (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS soko_product_comments_feed_idx
        ON soko_product_comments (product_id, created_at DESC, id DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS soko_product_share_events (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('share_completed', 'share_sheet_opened')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS soko_product_share_events_user_idx
        ON soko_product_share_events (user_id, product_id, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS soko_product_report_snapshots (
        report_id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        reporter_user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        reason_code TEXT,
        open BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`ALTER TABLE soko_product_report_snapshots ADD COLUMN IF NOT EXISTS reason_code TEXT`;
      await sql`ALTER TABLE soko_product_report_snapshots ADD COLUMN IF NOT EXISTS open BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS soko_product_report_open_uidx
        ON soko_product_report_snapshots (reporter_user_id, product_id, reason_code)
        WHERE open = TRUE`;
      await sql`CREATE TABLE IF NOT EXISTS soko_engagement_rate_buckets (
        bucket_key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL,
        hits INTEGER NOT NULL,
        window_start_ms BIGINT
      )`;
      await sql`ALTER TABLE soko_engagement_rate_buckets ADD COLUMN IF NOT EXISTS window_start_ms BIGINT`;
      await sql`CREATE TABLE IF NOT EXISTS kristo_safety_report_events (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_user_id TEXT,
        actor_role TEXT,
        title TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS soko_product_report_opened_event_uidx
        ON kristo_safety_report_events (report_id)
        WHERE event_type = 'report_opened'`;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

export async function dbConsumeEngagementRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now()
) {
  await ensureSokoEngagementSchema();
  return consumeEngagementRateLimit(sqlClient(), key, limit, windowMs, nowMs);
}

export async function dbGuardLikeSaveRate(userId: string, kind: "like" | "save") {
  const burst = kind === "like" ? RATE_LIMITS.likeBurst : RATE_LIMITS.saveBurst;
  const minute = kind === "like" ? RATE_LIMITS.likeMinute : RATE_LIMITS.saveMinute;
  const burstResult = await dbConsumeEngagementRateLimit(`${kind}:burst:${userId}`, burst.limit, burst.windowMs);
  if (!burstResult.allowed) return false;
  const minuteResult = await dbConsumeEngagementRateLimit(`${kind}:minute:${userId}`, minute.limit, minute.windowMs);
  return minuteResult.allowed;
}

function trustedHttps(value: unknown) {
  const text = String(value || "").trim();
  return /^https:\/\/[^\s]{8,480}$/i.test(text) ? text : null;
}

async function party(userId: string) {
  try {
    const profile = await getProfile(userId);
    if (!profile || String(profile.userId || "") !== userId) {
      return { userId, displayName: null, kristoId: null, avatarUrl: null };
    }
    return {
      userId,
      displayName: String(profile.fullName || "").trim() || null,
      kristoId: String(profile.userCode || "").trim() || null,
      avatarUrl: trustedHttps(profile.avatarUrl),
    };
  } catch {
    return { userId, displayName: null, kristoId: null, avatarUrl: null };
  }
}

export async function dbLoadWritableProduct(productId: string) {
  const product = await getSokoProductById(productId);
  if (!product) return { error: "missing" as const, product: null };
  const status = String(product.status || "");
  if (status === "Deleted") return { error: "inactive" as const, product };
  return { error: null, product };
}

export async function dbSetProductLike(productId: string, userId: string, liked: boolean) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  if (liked) {
    await sql`INSERT INTO soko_product_likes (product_id, user_id)
      VALUES (${productId}, ${userId})
      ON CONFLICT (product_id, user_id) DO NOTHING`;
  } else {
    await sql`DELETE FROM soko_product_likes
      WHERE product_id = ${productId} AND user_id = ${userId}`;
  }
  const rows = (await sql`SELECT COUNT(*)::int AS count FROM soko_product_likes
    WHERE product_id = ${productId}`) as Array<{ count: number }>;
  return { liked, likeCount: Number(rows[0]?.count || 0) };
}

export async function dbSetProductSave(productId: string, userId: string, saved: boolean) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  if (saved) {
    await sql`INSERT INTO soko_product_saves (product_id, user_id)
      VALUES (${productId}, ${userId})
      ON CONFLICT (product_id, user_id) DO NOTHING`;
  } else {
    await sql`DELETE FROM soko_product_saves
      WHERE product_id = ${productId} AND user_id = ${userId}`;
  }
  const mine = (await sql`SELECT 1 FROM soko_product_saves
    WHERE product_id = ${productId} AND user_id = ${userId} LIMIT 1`) as unknown[];
  return { saved: mine.length > 0 };
}

export async function dbListSavedProducts(userId: string) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const rows = (await sql`SELECT product_id, created_at FROM soko_product_saves
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, product_id DESC
    LIMIT 100`) as Array<{ product_id: string }>;
  const products = [];
  for (const row of rows) {
    const product = await getSokoProductById(row.product_id);
    if (!product) {
      products.push({
        id: row.product_id,
        title: "Listing unavailable",
        image: "",
        price: 0,
        currency: "",
        status: "Deleted",
        available: false,
      });
      continue;
    }
    const available = product.status === "Active";
    products.push({
      id: product.id,
      title: product.title,
      image: product.image,
      price: product.price,
      currency: product.currency,
      status: product.status,
      available,
    });
  }
  return products;
}

export async function dbCreateProductComment(productId: string, userId: string, body: unknown) {
  const clean = cleanCommentBody(body);
  if (!clean) throw Object.assign(new Error("Comment must be 1–500 characters."), { status: 400 });
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const limited = await dbConsumeEngagementRateLimit(
    `comment:${userId}`,
    RATE_LIMITS.commentMinute.limit,
    RATE_LIMITS.commentMinute.windowMs
  );
  if (!limited.allowed) {
    throw Object.assign(new Error("Please wait before commenting again."), { status: 429 });
  }
  const duplicate = (await sql`SELECT id FROM soko_product_comments
    WHERE product_id = ${productId} AND user_id = ${userId} AND body = ${clean}
      AND status <> 'deleted' AND created_at > NOW() - INTERVAL '120 seconds'
    LIMIT 1`) as Array<{ id: string }>;
  if (duplicate[0]) {
    throw Object.assign(new Error("That comment was just posted."), { status: 409 });
  }
  const id = `sokocmt_${randomUUID()}`;
  await sql`INSERT INTO soko_product_comments (id, product_id, user_id, body)
    VALUES (${id}, ${productId}, ${userId}, ${clean})`;
  const author = await party(userId);
  const count = await visibleCommentCount(sql, productId);
  return {
    comment: {
      id,
      body: clean,
      createdAt: new Date().toISOString(),
      author,
    },
    commentCount: count,
  };
}

async function visibleCommentCount(sql: Sql, productId: string) {
  const rows = (await sql`SELECT COUNT(*)::int AS count FROM soko_product_comments
    WHERE product_id = ${productId} AND status = 'visible'`) as Array<{ count: number }>;
  return Number(rows[0]?.count || 0);
}

export async function dbListProductComments(productId: string, cursor: string) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const before = String(cursor || "").trim();
  const rows = (before
    ? await sql`SELECT id, user_id, body, created_at FROM soko_product_comments
        WHERE product_id = ${productId} AND status = 'visible'
          AND (created_at, id) < (
            SELECT created_at, id FROM soko_product_comments WHERE id = ${before} LIMIT 1
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 21`
    : await sql`SELECT id, user_id, body, created_at FROM soko_product_comments
        WHERE product_id = ${productId} AND status = 'visible'
        ORDER BY created_at DESC, id DESC
        LIMIT 21`) as Array<{
    id: string;
    user_id: string;
    body: string;
    created_at: string | Date;
  }>;
  const page = rows.slice(0, 20);
  const comments = await Promise.all(
    page.map(async (row) => ({
      id: row.id,
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      author: await party(row.user_id),
    }))
  );
  return {
    comments,
    nextCursor: rows.length > 20 ? page[page.length - 1]?.id || null : null,
    commentCount: await visibleCommentCount(sql, productId),
  };
}

export async function dbDeleteOwnComment(productId: string, commentId: string, userId: string) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const rows = (await sql`SELECT user_id, status FROM soko_product_comments
    WHERE id = ${commentId} AND product_id = ${productId} LIMIT 1`) as Array<{
    user_id: string;
    status: string;
  }>;
  if (!rows[0]) throw Object.assign(new Error("Comment not found."), { status: 404 });
  if (rows[0].user_id !== userId) {
    throw Object.assign(new Error("You can only delete your own comment."), { status: 403 });
  }
  if (rows[0].status !== "deleted") {
    await sql`UPDATE soko_product_comments
      SET status = 'deleted', deleted_at = NOW(), moderated_at = NOW(),
          moderated_by_user_id = ${userId}, moderated_by_role = 'owner',
          moderation_reason = 'deleted by author'
      WHERE id = ${commentId}`;
    await sql`INSERT INTO soko_product_comment_moderation_events
      (id, comment_id, product_id, action, actor_user_id, actor_role, note)
      VALUES (${`sokomod_${randomUUID()}`}, ${commentId}, ${productId}, 'delete', ${userId}, 'owner', 'deleted by author')`;
  }
  return { commentCount: await visibleCommentCount(sql, productId) };
}

export async function dbHideProductComment(input: {
  productId: string;
  commentId: string;
  actorUserId: string;
  actorRole: "seller" | "System_Admin";
  note: string;
}) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const note = String(input.note || "").trim().slice(0, 500) || "hidden";
  const rows = (await sql`UPDATE soko_product_comments
    SET status = 'hidden', moderated_at = NOW(),
        moderated_by_user_id = ${input.actorUserId},
        moderated_by_role = ${input.actorRole},
        moderation_reason = ${note}
    WHERE id = ${input.commentId} AND product_id = ${input.productId} AND status = 'visible'
    RETURNING id`) as Array<{ id: string }>;
  if (!rows[0]) throw Object.assign(new Error("Comment not found."), { status: 404 });
  await sql`INSERT INTO soko_product_comment_moderation_events
    (id, comment_id, product_id, action, actor_user_id, actor_role, note)
    VALUES (
      ${`sokomod_${randomUUID()}`},
      ${input.commentId},
      ${input.productId},
      'hide',
      ${input.actorUserId},
      ${input.actorRole},
      ${note}
    )`;
  return { commentCount: await visibleCommentCount(sql, input.productId) };
}

export async function dbRecordShare(productId: string, userId: string, kind: ShareKind) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const limitedResult = await dbConsumeEngagementRateLimit(
    `share:${userId}:${productId}`,
    RATE_LIMITS.shareMinute.limit,
    RATE_LIMITS.shareMinute.windowMs
  );
  const limited = !limitedResult.allowed;
  if (!limited) {
    await sql`INSERT INTO soko_product_share_events (id, product_id, user_id, kind)
      VALUES (${`sokoshr_${randomUUID()}`}, ${productId}, ${userId}, ${kind})`;
  }
  const completed = (await sql`SELECT COUNT(*)::int AS count FROM soko_product_share_events
    WHERE product_id = ${productId} AND kind = 'share_completed'`) as Array<{ count: number }>;
  return {
    recorded: !limited,
    kind,
    completedShareCount: Number(completed[0]?.count || 0),
    measured: "completed_native_shares" as const,
  };
}

export async function dbEngagementForProducts(productIds: string[], viewerUserId: string) {
  await ensureSokoEngagementSchema();
  const ids = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 80);
  if (!ids.length) return new Map();
  const sql = sqlClient();
  const likes = (await sql`SELECT product_id, COUNT(*)::int AS count FROM soko_product_likes
    WHERE product_id = ANY(${ids}) GROUP BY product_id`) as Array<{ product_id: string; count: number }>;
  const comments = (await sql`SELECT product_id, COUNT(*)::int AS count FROM soko_product_comments
    WHERE product_id = ANY(${ids}) AND status = 'visible' GROUP BY product_id`) as Array<{
    product_id: string;
    count: number;
  }>;
  const shares = (await sql`SELECT product_id, COUNT(*)::int AS count FROM soko_product_share_events
    WHERE product_id = ANY(${ids}) AND kind = 'share_completed' GROUP BY product_id`) as Array<{
    product_id: string;
    count: number;
  }>;
  const mineLikes = viewerUserId
    ? ((await sql`SELECT product_id FROM soko_product_likes
        WHERE user_id = ${viewerUserId} AND product_id = ANY(${ids})`) as Array<{ product_id: string }>)
    : [];
  const mineSaves = viewerUserId
    ? ((await sql`SELECT product_id FROM soko_product_saves
        WHERE user_id = ${viewerUserId} AND product_id = ANY(${ids})`) as Array<{ product_id: string }>)
    : [];
  const likeMap = new Map(likes.map((row) => [row.product_id, Number(row.count)]));
  const commentMap = new Map(comments.map((row) => [row.product_id, Number(row.count)]));
  const shareMap = new Map(shares.map((row) => [row.product_id, Number(row.count)]));
  const liked = new Set(mineLikes.map((row) => row.product_id));
  const saved = new Set(mineSaves.map((row) => row.product_id));
  return new Map(
    ids.map((id) => [
      id,
      {
        likeCount: likeMap.get(id) || 0,
        commentCount: commentMap.get(id) || 0,
        completedShareCount: shareMap.get(id) || 0,
        shareMeasured: "completed_native_shares",
        liked: liked.has(id),
        saved: saved.has(id),
      },
    ])
  );
}

export type { OpenProductReportSlot };

export async function dbReadOpenProductReportSlot(input: {
  reporterUserId: string;
  productId: string;
  reasonCode: string;
}) {
  await ensureSokoEngagementSchema();
  return readOpenProductReportSlot(sqlClient(), input);
}

export async function dbClaimOpenProductReport(input: {
  reportId: string;
  productId: string;
  reporterUserId: string;
  reason: string;
  reasonCode: string;
  snapshot: Record<string, unknown>;
}) {
  await ensureSokoEngagementSchema();
  return claimOpenProductReport(sqlClient(), input);
}

export async function dbEnsureProductReportOpenedEvent(input: {
  reportId: string;
  actorUserId: string;
  details: string;
}) {
  await ensureSokoEngagementSchema();
  return ensureProductReportOpenedEvent(sqlClient(), input);
}

export async function dbSyncSnapshotOpenFlag(reportId: string, status: string) {
  await ensureSokoEngagementSchema();
  return syncSnapshotOpenFlag(sqlClient(), reportId, status);
}

export async function dbCloseProductReportSnapshot(reportId: string) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  await sql`UPDATE soko_product_report_snapshots SET open = FALSE WHERE report_id = ${reportId}`;
}

export async function dbFindOpenProductReport(input: {
  reporterUserId: string;
  productId: string;
  reasonCode: string;
}) {
  await ensureSokoEngagementSchema();
  const sql = sqlClient();
  const rows = (await sql`SELECT s.report_id, r.report_code, r.status, r.created_at
    FROM soko_product_report_snapshots s
    JOIN kristo_safety_reports r ON r.id = s.report_id
    WHERE s.reporter_user_id = ${input.reporterUserId}
      AND s.product_id = ${input.productId}
      AND s.reason_code = ${input.reasonCode}
      AND s.open = TRUE
      AND r.status NOT IN ('resolved', 'dismissed')
    ORDER BY s.created_at DESC
    LIMIT 1`) as Array<{
    report_id: string;
    report_code: string;
    status: string;
    created_at: string | Date;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.report_id,
    reportCode: row.report_code,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
