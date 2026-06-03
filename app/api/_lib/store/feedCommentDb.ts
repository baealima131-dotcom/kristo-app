import { neon, neonConfig } from "@neondatabase/serverless";
import { readJsonFile, writeJsonFile, getKristoDataDir } from "@/app/api/_lib/store/fs";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type FeedComment = {
  id: string;
  churchId: string;
  postId: string;
  parentCommentId?: string;
  text: string;
  createdAt: string;
  createdBy: string;
  authorName?: string;
  authorAvatarUri?: string;
  authorInitial?: string;
};

export type FeedCommentLike = {
  churchId: string;
  commentId: string;
  userId: string;
  createdAt: string;
};

export type FeedPostLike = {
  churchId: string;
  postId: string;
  userId: string;
  createdAt: string;
};

export type DiscussionCounts = {
  commentCount: number;
  replyCount: number;
};

type CommentRow = {
  id: string;
  church_id: string;
  post_id: string;
  parent_comment_id: string | null;
  text: string;
  created_at: string;
  created_by: string;
  author_name: string | null;
  author_avatar_uri: string | null;
  author_initial: string | null;
};

type CommentLikeRow = {
  church_id: string;
  comment_id: string;
  user_id: string;
  created_at: string;
};

type PostLikeRow = {
  church_id: string;
  post_id: string;
  user_id: string;
  created_at: string;
};

const LOCAL_COMMENTS_FILE = "church-feed-comments.json";
const LOCAL_COMMENT_LIKES_FILE = "church-feed-comment-likes.json";
const LOCAL_POST_LIKES_FILE = "church-feed-likes.json";

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

export type CommentStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

export function resolveCommentStoreMode(): CommentStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

function storePathForMode(mode: CommentStoreMode) {
  if (mode === "postgres") return "postgres:kristo_church_feed_comments";
  if (mode === "missing-db-on-vercel") return "unavailable:vercel-no-database";
  return `local-json:${getKristoDataDir()}/${LOCAL_COMMENTS_FILE}`;
}

export function logCommentStoreEvent(args: {
  op: "read" | "write";
  count: number;
  detail?: string;
}) {
  const mode = resolveCommentStoreMode();
  const path = storePathForMode(mode);
  console.log("KRISTO_COMMENT_STORE_MODE", { mode });
  if (args.op === "write") {
    console.log("KRISTO_COMMENT_STORE_WRITE_PATH", { path, detail: args.detail || null });
    console.log("KRISTO_COMMENT_STORE_WRITE_COUNT", { count: args.count });
  } else {
    console.log("KRISTO_COMMENT_STORE_READ_PATH", { path, detail: args.detail || null });
    console.log("KRISTO_COMMENT_STORE_READ_COUNT", { count: args.count });
  }
}

export async function ensureCommentStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Comment database not configured");
  }
  if (usePostgres()) {
    await ensureCommentSchema();
  }
}

export function isCommentDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("comment database not configured") ||
    message.includes("database_url not configured")
  );
}

export async function ensureCommentSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_feed_comments (
          id TEXT PRIMARY KEY,
          church_id TEXT NOT NULL,
          post_id TEXT NOT NULL,
          parent_comment_id TEXT,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by TEXT NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_comments_post_idx
        ON kristo_church_feed_comments (church_id, post_id)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_feed_comment_likes (
          church_id TEXT NOT NULL,
          comment_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (comment_id, user_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_comment_likes_church_idx
        ON kristo_church_feed_comment_likes (church_id, comment_id)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_church_feed_post_likes (
          church_id TEXT NOT NULL,
          post_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (post_id, user_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_church_feed_post_likes_church_idx
        ON kristo_church_feed_post_likes (church_id, post_id)
      `;
      await sql`ALTER TABLE kristo_church_feed_comments ADD COLUMN IF NOT EXISTS author_name TEXT`;
      await sql`ALTER TABLE kristo_church_feed_comments ADD COLUMN IF NOT EXISTS author_avatar_uri TEXT`;
      await sql`ALTER TABLE kristo_church_feed_comments ADD COLUMN IF NOT EXISTS author_initial TEXT`;
    })();
  }
  await schemaReady;
}

function rowToComment(row: CommentRow): FeedComment {
  const authorName = String(row.author_name || "").trim() || undefined;
  const authorAvatarUri = String(row.author_avatar_uri || "").trim() || undefined;
  const authorInitial = String(row.author_initial || "").trim() || undefined;

  return {
    id: row.id,
    churchId: row.church_id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id || undefined,
    text: row.text,
    createdAt: row.created_at,
    createdBy: row.created_by,
    authorName,
    authorAvatarUri,
    authorInitial,
  };
}

async function readLocalComments(): Promise<FeedComment[]> {
  const rows = await readJsonFile<FeedComment[]>(LOCAL_COMMENTS_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalComments(rows: FeedComment[]) {
  await writeJsonFile(LOCAL_COMMENTS_FILE, rows);
  logCommentStoreEvent({ op: "write", count: rows.length, detail: "comments" });
}

async function readLocalCommentLikes(): Promise<FeedCommentLike[]> {
  const rows = await readJsonFile<FeedCommentLike[]>(LOCAL_COMMENT_LIKES_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalCommentLikes(rows: FeedCommentLike[]) {
  await writeJsonFile(LOCAL_COMMENT_LIKES_FILE, rows);
}

async function readLocalPostLikes(): Promise<FeedPostLike[]> {
  const rows = await readJsonFile<FeedPostLike[]>(LOCAL_POST_LIKES_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function writeLocalPostLikes(rows: FeedPostLike[]) {
  await writeJsonFile(LOCAL_POST_LIKES_FILE, rows);
}

export async function insertFeedComment(comment: FeedComment): Promise<FeedComment> {
  await ensureCommentStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    await sql`
      INSERT INTO kristo_church_feed_comments (
        id, church_id, post_id, parent_comment_id, text, created_at, created_by,
        author_name, author_avatar_uri, author_initial
      ) VALUES (
        ${comment.id},
        ${comment.churchId},
        ${comment.postId},
        ${comment.parentCommentId || null},
        ${comment.text},
        ${comment.createdAt},
        ${comment.createdBy},
        ${comment.authorName || null},
        ${comment.authorAvatarUri || null},
        ${comment.authorInitial || null}
      )
    `;
    logCommentStoreEvent({ op: "write", count: 1, detail: `insert:${comment.id}` });
    return comment;
  }

  const all = await readLocalComments();
  all.push(comment);
  await writeLocalComments(all);
  return comment;
}

export async function findFeedCommentById(commentId: string): Promise<FeedComment | null> {
  const id = String(commentId || "").trim();
  if (!id) return null;

  try {
    await ensureCommentStoreReady();
  } catch (error) {
    if (isCommentDatabaseError(error)) {
      logCommentStoreEvent({ op: "read", count: 0, detail: `find:${id}:unconfigured` });
      return null;
    }
    throw error;
  }

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT
        id, church_id, post_id, parent_comment_id, text, created_at, created_by,
        author_name, author_avatar_uri, author_initial
      FROM kristo_church_feed_comments
      WHERE id = ${id}
      LIMIT 1
    `;
    const row = (rows as CommentRow[])[0];
    logCommentStoreEvent({ op: "read", count: row ? 1 : 0, detail: `find:${id}` });
    return row ? rowToComment(row) : null;
  }

  const all = await readLocalComments();
  const found = all.find((x) => String(x.id || "") === id) || null;
  logCommentStoreEvent({ op: "read", count: found ? 1 : 0, detail: `find:${id}` });
  return found;
}

export async function listCommentsForPostIds(
  churchId: string,
  postIds: Set<string>
): Promise<FeedComment[]> {
  const cid = String(churchId || "").trim();
  const ids = [...postIds].map((x) => String(x || "").trim()).filter(Boolean);
  if (!cid || !ids.length) {
    logCommentStoreEvent({ op: "read", count: 0, detail: "list:empty-input" });
    return [];
  }

  try {
    await ensureCommentStoreReady();
  } catch (error) {
    if (isCommentDatabaseError(error)) {
      logCommentStoreEvent({ op: "read", count: 0, detail: "list:unconfigured" });
      return [];
    }
    throw error;
  }

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT
        id, church_id, post_id, parent_comment_id, text, created_at, created_by,
        author_name, author_avatar_uri, author_initial
      FROM kristo_church_feed_comments
      WHERE church_id = ${cid} AND post_id = ANY(${ids})
      ORDER BY created_at ASC
    `;
    const items = (rows as CommentRow[]).map(rowToComment);
    logCommentStoreEvent({ op: "read", count: items.length, detail: `list:${ids.join(",")}` });
    return items;
  }

  const all = await readLocalComments();
  const items = all.filter(
    (x) => x.churchId === cid && ids.includes(String(x.postId || ""))
  );
  logCommentStoreEvent({ op: "read", count: items.length, detail: `list:${ids.join(",")}` });
  return items;
}

export async function countDiscussionForPostIds(
  postIds: Iterable<string>
): Promise<Map<string, DiscussionCounts>> {
  const ids = [...new Set([...postIds].map((x) => String(x || "").trim()).filter(Boolean))];
  const result = new Map<string, DiscussionCounts>();
  for (const id of ids) {
    result.set(id, { commentCount: 0, replyCount: 0 });
  }
  if (!ids.length) {
    logCommentStoreEvent({ op: "read", count: 0, detail: "count-discussion:empty" });
    return result;
  }

  try {
    await ensureCommentStoreReady();
  } catch (error) {
    if (isCommentDatabaseError(error)) {
      logCommentStoreEvent({ op: "read", count: 0, detail: "count-discussion:unconfigured" });
      return result;
    }
    throw error;
  }

  if (usePostgres()) {
    const sql = getSql();
    const rows = await sql`
      SELECT
        post_id,
        COUNT(*) FILTER (WHERE parent_comment_id IS NULL)::int AS root_count,
        COUNT(*) FILTER (WHERE parent_comment_id IS NOT NULL)::int AS reply_count
      FROM kristo_church_feed_comments
      WHERE post_id = ANY(${ids})
      GROUP BY post_id
    `;
    for (const row of rows as any[]) {
      const postId = String(row.post_id || "").trim();
      if (!postId) continue;
      result.set(postId, {
        commentCount: Number(row.root_count || 0),
        replyCount: Number(row.reply_count || 0),
      });
    }
    logCommentStoreEvent({
      op: "read",
      count: (rows as any[]).length,
      detail: `count-discussion:${ids.length}-posts`,
    });
    return result;
  }

  const all = await readLocalComments();
  for (const row of all) {
    const postId = String(row.postId || "").trim();
    if (!ids.includes(postId)) continue;
    const cur = result.get(postId) || { commentCount: 0, replyCount: 0 };
    if (row.parentCommentId) cur.replyCount += 1;
    else cur.commentCount += 1;
    result.set(postId, cur);
  }
  logCommentStoreEvent({
    op: "read",
    count: all.filter((x) => ids.includes(String(x.postId || ""))).length,
    detail: `count-discussion:${ids.length}-posts`,
  });
  return result;
}

export async function countDiscussionForPostIdSet(
  postIds: Set<string>
): Promise<{ commentCount: number; replyCount: number }> {
  const map = await countDiscussionForPostIds(postIds);
  let commentCount = 0;
  let replyCount = 0;
  for (const id of postIds) {
    const counts = map.get(String(id || "").trim());
    if (!counts) continue;
    commentCount += counts.commentCount;
    replyCount += counts.replyCount;
  }
  return { commentCount, replyCount };
}

export async function deleteEngagementForPost(postId: string): Promise<void> {
  const pid = String(postId || "").trim();
  if (!pid) return;
  await ensureCommentStoreReady();

  if (usePostgres()) {
    const sql = getSql();
    const commentRows = await sql`
      SELECT id FROM kristo_church_feed_comments WHERE post_id = ${pid}
    `;
    const commentIds = (commentRows as { id: string }[]).map((x) => x.id).filter(Boolean);
    if (commentIds.length) {
      await sql`
        DELETE FROM kristo_church_feed_comment_likes
        WHERE comment_id = ANY(${commentIds})
      `;
    }
    await sql`DELETE FROM kristo_church_feed_comments WHERE post_id = ${pid}`;
    await sql`DELETE FROM kristo_church_feed_post_likes WHERE post_id = ${pid}`;
    logCommentStoreEvent({ op: "write", count: 0, detail: `delete-post:${pid}` });
    return;
  }

  const comments = await readLocalComments();
  const removedCommentIds = new Set(
    comments.filter((x) => String(x.postId || "") === pid).map((x) => String(x.id || ""))
  );
  const nextComments = comments.filter((x) => String(x.postId || "") !== pid);
  await writeLocalComments(nextComments);

  const postLikes = await readLocalPostLikes();
  await writeLocalPostLikes(postLikes.filter((x) => String(x.postId || "") !== pid));

  const commentLikes = await readLocalCommentLikes();
  await writeLocalCommentLikes(
    commentLikes.filter((x) => !removedCommentIds.has(String(x.commentId || "")))
  );
  logCommentStoreEvent({ op: "write", count: 0, detail: `delete-post:${pid}` });
}

export async function getPostLikeMeta(
  churchId: string,
  postId: string,
  viewerUserId: string
): Promise<{ likeCount: number; likedByMe: boolean }> {
  const cid = String(churchId || "").trim();
  const pid = String(postId || "").trim();
  if (!cid || !pid) return { likeCount: 0, likedByMe: false };

  try {
    await ensureCommentStoreReady();
  } catch (error) {
    if (isCommentDatabaseError(error)) return { likeCount: 0, likedByMe: false };
    throw error;
  }

  if (usePostgres()) {
    const sql = getSql();
    const countRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM kristo_church_feed_post_likes
      WHERE church_id = ${cid} AND post_id = ${pid}
    `;
    const likedRows = await sql`
      SELECT 1
      FROM kristo_church_feed_post_likes
      WHERE church_id = ${cid} AND post_id = ${pid} AND user_id = ${viewerUserId}
      LIMIT 1
    `;
    return {
      likeCount: Number((countRows as any[])?.[0]?.count || 0),
      likedByMe: (likedRows as any[]).length > 0,
    };
  }

  const likes = await readLocalPostLikes();
  const scoped = likes.filter((x) => x.churchId === cid && x.postId === pid);
  return {
    likeCount: scoped.length,
    likedByMe: scoped.some((x) => x.userId === viewerUserId),
  };
}

export async function togglePostLike(args: {
  churchId: string;
  postId: string;
  viewerUserId: string;
  wantsLiked: boolean | null;
}): Promise<{ likedByMe: boolean; likeCount: number }> {
  await ensureCommentStoreReady();
  const cid = String(args.churchId || "").trim();
  const pid = String(args.postId || "").trim();
  const uid = String(args.viewerUserId || "").trim();
  const now = new Date().toISOString();

  if (usePostgres()) {
    const sql = getSql();
    const existing = await sql`
      SELECT user_id
      FROM kristo_church_feed_post_likes
      WHERE church_id = ${cid} AND post_id = ${pid} AND user_id = ${uid}
      LIMIT 1
    `;
    const hasLike = (existing as any[]).length > 0;
    let likedByMe = hasLike;

    if (args.wantsLiked === true) {
      if (!hasLike) {
        await sql`
          INSERT INTO kristo_church_feed_post_likes (church_id, post_id, user_id, created_at)
          VALUES (${cid}, ${pid}, ${uid}, ${now})
          ON CONFLICT (post_id, user_id) DO NOTHING
        `;
      }
      likedByMe = true;
    } else if (args.wantsLiked === false) {
      if (hasLike) {
        await sql`
          DELETE FROM kristo_church_feed_post_likes
          WHERE church_id = ${cid} AND post_id = ${pid} AND user_id = ${uid}
        `;
      }
      likedByMe = false;
    } else if (hasLike) {
      await sql`
        DELETE FROM kristo_church_feed_post_likes
        WHERE church_id = ${cid} AND post_id = ${pid} AND user_id = ${uid}
      `;
      likedByMe = false;
    } else {
      await sql`
        INSERT INTO kristo_church_feed_post_likes (church_id, post_id, user_id, created_at)
        VALUES (${cid}, ${pid}, ${uid}, ${now})
        ON CONFLICT (post_id, user_id) DO NOTHING
      `;
      likedByMe = true;
    }

    const meta = await getPostLikeMeta(cid, pid, uid);
    logCommentStoreEvent({ op: "write", count: 1, detail: `toggle-post-like:${pid}` });
    return { likedByMe, likeCount: meta.likeCount };
  }

  const likes = await readLocalPostLikes();
  const index = likes.findIndex(
    (x) => x.churchId === cid && x.postId === pid && x.userId === uid
  );
  let likedByMe = index >= 0;

  if (args.wantsLiked === true) {
    if (index < 0) likes.push({ churchId: cid, postId: pid, userId: uid, createdAt: now });
    likedByMe = true;
  } else if (args.wantsLiked === false) {
    if (index >= 0) likes.splice(index, 1);
    likedByMe = false;
  } else if (index >= 0) {
    likes.splice(index, 1);
    likedByMe = false;
  } else {
    likes.push({ churchId: cid, postId: pid, userId: uid, createdAt: now });
    likedByMe = true;
  }

  await writeLocalPostLikes(likes);
  logCommentStoreEvent({ op: "write", count: likes.length, detail: `toggle-post-like:${pid}` });
  return {
    likedByMe,
    likeCount: likes.filter((x) => x.churchId === cid && x.postId === pid).length,
  };
}

export async function getCommentLikeMetaForIds(
  churchId: string,
  commentIds: string[],
  viewerUserId: string
): Promise<Map<string, { likeCount: number; likedByMe: boolean }>> {
  const result = new Map<string, { likeCount: number; likedByMe: boolean }>();
  const ids = [...new Set(commentIds.map((x) => String(x || "").trim()).filter(Boolean))];
  for (const id of ids) {
    result.set(id, { likeCount: 0, likedByMe: false });
  }
  if (!ids.length) return result;

  const cid = String(churchId || "").trim();
  const uid = String(viewerUserId || "").trim();

  try {
    await ensureCommentStoreReady();
  } catch (error) {
    if (isCommentDatabaseError(error)) return result;
    throw error;
  }

  if (usePostgres()) {
    const sql = getSql();
    const countRows = await sql`
      SELECT comment_id, COUNT(*)::int AS count
      FROM kristo_church_feed_comment_likes
      WHERE church_id = ${cid} AND comment_id = ANY(${ids})
      GROUP BY comment_id
    `;
    for (const row of countRows as any[]) {
      const commentId = String(row.comment_id || "").trim();
      if (!commentId) continue;
      result.set(commentId, {
        likeCount: Number(row.count || 0),
        likedByMe: false,
      });
    }
    const likedRows = await sql`
      SELECT comment_id
      FROM kristo_church_feed_comment_likes
      WHERE church_id = ${cid} AND user_id = ${uid} AND comment_id = ANY(${ids})
    `;
    for (const row of likedRows as any[]) {
      const commentId = String(row.comment_id || "").trim();
      if (!commentId) continue;
      const cur = result.get(commentId) || { likeCount: 0, likedByMe: false };
      result.set(commentId, { ...cur, likedByMe: true });
    }
    return result;
  }

  const likes = await readLocalCommentLikes();
  for (const id of ids) {
    const scoped = likes.filter((x) => x.churchId === cid && x.commentId === id);
    result.set(id, {
      likeCount: scoped.length,
      likedByMe: scoped.some((x) => x.userId === uid),
    });
  }
  return result;
}

export async function toggleCommentLike(args: {
  churchId: string;
  commentId: string;
  viewerUserId: string;
}): Promise<{ likedByMe: boolean; likeCount: number }> {
  await ensureCommentStoreReady();
  const cid = String(args.churchId || "").trim();
  const commentId = String(args.commentId || "").trim();
  const uid = String(args.viewerUserId || "").trim();
  const now = new Date().toISOString();

  if (usePostgres()) {
    const sql = getSql();
    const existing = await sql`
      SELECT user_id
      FROM kristo_church_feed_comment_likes
      WHERE church_id = ${cid} AND comment_id = ${commentId} AND user_id = ${uid}
      LIMIT 1
    `;
    let likedByMe = false;
    if ((existing as any[]).length > 0) {
      await sql`
        DELETE FROM kristo_church_feed_comment_likes
        WHERE church_id = ${cid} AND comment_id = ${commentId} AND user_id = ${uid}
      `;
      likedByMe = false;
    } else {
      await sql`
        INSERT INTO kristo_church_feed_comment_likes (church_id, comment_id, user_id, created_at)
        VALUES (${cid}, ${commentId}, ${uid}, ${now})
        ON CONFLICT (comment_id, user_id) DO NOTHING
      `;
      likedByMe = true;
    }
    const meta = await getCommentLikeMetaForIds(cid, [commentId], uid);
    const row = meta.get(commentId) || { likeCount: 0, likedByMe };
    logCommentStoreEvent({ op: "write", count: 1, detail: `toggle-comment-like:${commentId}` });
    return { likedByMe: row.likedByMe, likeCount: row.likeCount };
  }

  const likes = await readLocalCommentLikes();
  const index = likes.findIndex(
    (x) => x.churchId === cid && x.commentId === commentId && x.userId === uid
  );
  let likedByMe = false;
  if (index >= 0) {
    likes.splice(index, 1);
    likedByMe = false;
  } else {
    likes.push({ churchId: cid, commentId, userId: uid, createdAt: now });
    likedByMe = true;
  }
  await writeLocalCommentLikes(likes);
  const scoped = likes.filter((x) => x.churchId === cid && x.commentId === commentId);
  logCommentStoreEvent({ op: "write", count: scoped.length, detail: `toggle-comment-like:${commentId}` });
  return { likedByMe, likeCount: scoped.length };
}
