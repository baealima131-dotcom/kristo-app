import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";
import { loadProfileDraft } from "@/src/lib/profileStore";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { commentAvatarUrl } from "@/src/components/homeFeed/homeFeedUtils";

export type FeedCommentNode = {
  id: string;
  postId: string;
  parentCommentId?: string;
  text: string;
  createdAt: string;
  createdBy: string;
  authorName: string;
  authorAvatarUri: string;
  authorInitial: string;
  likeCount: number;
  likedByMe: boolean;
  replyCount: number;
  replies: FeedCommentNode[];
};

function sessionHeaders() {
  const session = getSessionSync() as any;
  return getKristoHeaders({
    userId: session?.userId || "",
    role: (session?.role || "Member") as any,
    churchId: session?.churchId || "",
  });
}

export function userHasActiveChurchMembership(session?: any) {
  return Boolean(String(session?.churchId || session?.activeChurchId || "").trim());
}

/** Canonical backend post id — same value for open, POST, reload, and counts. */
export function normalizeCommentPostId(postId: unknown) {
  return baseFeedId(postId);
}

function sessionUserId() {
  return String((getSessionSync() as any)?.userId || "").trim();
}

export function clearCommentFeedCache(postId: string) {
  const cleanPostId = normalizeCommentPostId(postId);
  if (!cleanPostId) return;
  clearResponseCacheForRequest(
    "GET",
    `/api/church/feed?id=${encodeURIComponent(cleanPostId)}`,
    sessionUserId()
  );
}

export function formatCommentTime(createdAt?: string) {
  const ms = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(ms)) return "";
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const DELETED_COMMENT_USER = "Deleted User";

export function looksLikeUserId(value: string) {
  const v = String(value || "").trim();
  if (!v) return true;
  if (v === "Member" || v === "u-unknown") return true;
  if (/^u[-_]?/i.test(v)) return true;
  if (/^[a-f0-9-]{18,}$/i.test(v)) return true;
  if (v.length >= 20 && !v.includes(" ")) return true;
  return false;
}

function sessionProfileForUserId(userId: string) {
  const session = getSessionSync() as any;
  const id = String(userId || "").trim();
  if (!id || id !== String(session?.userId || "").trim()) return null;
  const name = String(session?.displayName || session?.name || "").trim();
  const avatar = commentAvatarUrl(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  );
  return { name, avatar };
}

function pickDisplayName(raw: any) {
  const createdBy = String(raw?.createdBy || "").trim();
  const candidates = [
    raw?.userName,
    raw?.displayName,
    raw?.name,
    raw?.profileName,
    raw?.fullName,
    raw?.authorName,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!looksLikeUserId(candidate) && candidate !== createdBy) return candidate;
  }

  const self = sessionProfileForUserId(createdBy);
  if (self?.name && !looksLikeUserId(self.name)) return self.name;

  return DELETED_COMMENT_USER;
}

function pickAvatarUri(raw: any, displayName: string) {
  const createdBy = String(raw?.createdBy || "").trim();
  const isDeleted = displayName === DELETED_COMMENT_USER;
  if (isDeleted) return "";

  const candidates = [
    raw?.userAvatarUri,
    raw?.avatarUri,
    raw?.profileAvatarUri,
    raw?.authorAvatarUri,
    raw?.avatarUrl,
    raw?.profileImage,
    raw?.photoURL,
  ];

  for (const candidate of candidates) {
    const uri = commentAvatarUrl(candidate);
    if (uri) return uri;
  }

  const self = sessionProfileForUserId(createdBy);
  if (self?.avatar) return self.avatar;

  return "";
}

export function resolveCommentAuthor(raw: any) {
  const authorName = pickDisplayName(raw);
  const isDeleted = authorName === DELETED_COMMENT_USER;
  const authorAvatarUri = pickAvatarUri(raw, authorName);
  const initial = isDeleted
    ? "D"
    : String(raw?.authorInitial || authorName).trim().charAt(0).toUpperCase() || "U";

  return { authorName, authorAvatarUri, authorInitial: initial, isDeleted };
}

function patchNodeFromProfileDraft(
  node: FeedCommentNode,
  draft: { displayName?: string; avatarUri?: string } | null
): FeedCommentNode {
  if (!draft) return node;

  const nextName = String(draft.displayName || "").trim();
  const nextAvatar = commentAvatarUrl(draft.avatarUri || "");
  const nameLooksLikeId = looksLikeUserId(node.authorName);
  const shouldPatchName =
    nameLooksLikeId && nextName && !looksLikeUserId(nextName) && nextName !== node.createdBy;
  const shouldPatchAvatar = !node.authorAvatarUri && Boolean(nextAvatar);

  const authorName = shouldPatchName ? nextName : node.authorName;
  const authorAvatarUri = shouldPatchAvatar ? nextAvatar : node.authorAvatarUri;
  const authorInitial = authorName.charAt(0).toUpperCase() || node.authorInitial;

  return {
    ...node,
    authorName,
    authorAvatarUri,
    authorInitial,
    replies: node.replies,
  };
}

function patchNodeWithDraftMap(node: FeedCommentNode, drafts: Map<string, any>) {
  const draft = drafts.get(String(node.createdBy || "").trim()) || null;
  const patched = patchNodeFromProfileDraft(node, draft);
  return {
    ...patched,
    replies: patched.replies.map((reply) => {
      const replyDraft = drafts.get(String(reply.createdBy || "").trim()) || null;
      return patchNodeFromProfileDraft(reply, replyDraft);
    }),
  };
}

export async function enrichCommentsFromLocalProfiles(
  comments: FeedCommentNode[]
): Promise<FeedCommentNode[]> {
  const userIds = new Set<string>();

  const walk = (nodes: FeedCommentNode[]) => {
    for (const node of nodes) {
      const id = String(node.createdBy || "").trim();
      if (id && looksLikeUserId(node.authorName)) userIds.add(id);
      if (node.replies.length) walk(node.replies);
    }
  };

  walk(comments);
  if (!userIds.size) return comments;

  const drafts = new Map<string, any>();
  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      const draft = await loadProfileDraft(userId);
      if (draft) drafts.set(userId, draft);
    })
  );

  if (!drafts.size) return comments;
  return comments.map((node) => patchNodeWithDraftMap(node, drafts));
}

export function mentionPrefixForAuthor(authorName: string) {
  const handle = String(authorName || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "");
  if (!handle || authorName === DELETED_COMMENT_USER) return "";
  return `@${handle} `;
}

function commentTimestampMs(createdAt?: string) {
  const ms = Date.parse(String(createdAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function sortCommentsTree(comments: FeedCommentNode[]): FeedCommentNode[] {
  return comments
    .slice()
    .sort((a, b) => commentTimestampMs(b.createdAt) - commentTimestampMs(a.createdAt))
    .map((node) => {
      const replies = node.replies
        .slice()
        .sort((a, b) => commentTimestampMs(a.createdAt) - commentTimestampMs(b.createdAt));
      return { ...node, replies, replyCount: replies.length };
    });
}

function normalizeComment(raw: any): FeedCommentNode {
  const { authorName, authorAvatarUri, authorInitial } = resolveCommentAuthor(raw);

  const replies = Array.isArray(raw?.replies)
    ? raw.replies
        .map(normalizeComment)
        .sort(
          (a: FeedCommentNode, b: FeedCommentNode) =>
            commentTimestampMs(a.createdAt) - commentTimestampMs(b.createdAt)
        )
    : [];

  return {
    id: String(raw?.id || ""),
    postId: String(raw?.postId || ""),
    parentCommentId: raw?.parentCommentId ? String(raw.parentCommentId) : undefined,
    text: String(raw?.text || ""),
    createdAt: String(raw?.createdAt || ""),
    createdBy: String(raw?.createdBy || ""),
    authorName,
    authorAvatarUri,
    authorInitial,
    likeCount: Number(raw?.likeCount || 0),
    likedByMe: Boolean(raw?.likedByMe),
    replyCount: replies.length,
    replies,
  };
}

export function discussionCountFromPayload(payload: any) {
  const commentCount = Number(payload?.commentCount || 0);
  const replyCount = Number(payload?.replyCount || 0);
  const total = Number(payload?.totalDiscussionCount || 0);
  if (total > 0) return total;
  return commentCount + replyCount;
}

export async function fetchFeedComments(postId: string, options?: { bypassCache?: boolean }) {
  const cleanPostId = normalizeCommentPostId(postId);
  if (!cleanPostId) {
    return { ok: false as const, error: "Missing post id", comments: [] as FeedCommentNode[] };
  }

  if (options?.bypassCache) {
    clearCommentFeedCache(cleanPostId);
  }

  console.log("KRISTO_COMMENTS_LOAD", { postId: cleanPostId });

  try {
    const res: any = await apiGet(
      `/api/church/feed?id=${encodeURIComponent(cleanPostId)}`,
      { headers: sessionHeaders() },
      { screen: "HomeFeedComments", throttleMs: 0, dedupe: false }
    );

    if (!res?.ok) {
      console.log("KRISTO_COMMENT_FAILED", { postId: cleanPostId, stage: "load", error: res?.error });
      return {
        ok: false as const,
        error: String(res?.error || "Failed to load comments"),
        comments: [] as FeedCommentNode[],
      };
    }

    const rows = Array.isArray(res?.data?.comments) ? res.data.comments : [];
    const comments = sortCommentsTree(rows.map(normalizeComment));
    const discussionCount = discussionCountFromPayload(res?.data?.item || {});

    console.log("KRISTO_COMMENTS_LOAD_RESPONSE", {
      postId: cleanPostId,
      count: comments.length,
      ids: comments.map((c) => c.id),
    });

    return { ok: true as const, comments, discussionCount };
  } catch (error: any) {
    console.log("KRISTO_COMMENT_FAILED", {
      postId: cleanPostId,
      stage: "load",
      message: String(error?.message || error),
    });
    return {
      ok: false as const,
      error: String(error?.message || "Failed to load comments"),
      comments: [] as FeedCommentNode[],
    };
  }
}

export async function reloadFeedCommentsAfterPost(postId: string) {
  const cleanPostId = normalizeCommentPostId(postId);
  console.log("KRISTO_COMMENTS_RELOAD_AFTER_POST", { postId: cleanPostId });
  return fetchFeedComments(cleanPostId, { bypassCache: true });
}

export function mergeCommentsAfterSuccessfulPost(
  current: FeedCommentNode[],
  tempId: string,
  saved: FeedCommentNode | null,
  reloaded: FeedCommentNode[]
): FeedCommentNode[] {
  if (saved?.id) {
    return replaceCommentInTree(current, tempId, saved);
  }
  if (reloaded.length > 0) {
    return reloaded;
  }
  return current;
}

export async function submitFeedComment(postId: string, text: string) {
  const cleanPostId = normalizeCommentPostId(postId);
  console.log("KRISTO_COMMENT_POST_REQUEST", { postId: cleanPostId, text: text.slice(0, 120) });

  try {
    const res: any = await apiPost(
      "/api/church/feed",
      { action: "add_comment", postId: cleanPostId, text },
      { headers: sessionHeaders() }
    );

    if (!res?.ok) {
      console.log("KRISTO_COMMENT_FAILED", { postId: cleanPostId, error: res?.error });
      return { ok: false as const, error: String(res?.error || "Failed to post comment") };
    }

    clearCommentFeedCache(cleanPostId);

    const comment = res?.data?.comment ? normalizeComment(res.data.comment) : null;
    const discussionCount = discussionCountFromPayload(res?.data);
    const returnedCount =
      Number(res?.data?.commentCount || 0) + Number(res?.data?.replyCount || 0);

    console.log("KRISTO_COMMENT_POST_RESPONSE", {
      postId: cleanPostId,
      ok: true,
      commentId: comment?.id || "",
      returnedCount,
    });
    console.log("KRISTO_COMMENT_SUCCESS", { postId: cleanPostId });

    return { ok: true as const, comment, discussionCount, returnedCount };
  } catch (error: any) {
    console.log("KRISTO_COMMENT_FAILED", {
      postId: cleanPostId,
      message: String(error?.message || error),
    });
    return { ok: false as const, error: String(error?.message || "Failed to post comment") };
  }
}

export async function submitFeedReply(postId: string, parentCommentId: string, text: string) {
  const cleanPostId = normalizeCommentPostId(postId);
  const cleanParentId = String(parentCommentId || "").trim();
  console.log("KRISTO_REPLY_SUBMIT", { postId: cleanPostId, parentCommentId: cleanParentId });

  try {
    const res: any = await apiPost(
      "/api/church/feed",
      {
        action: "add_reply",
        postId: cleanPostId,
        parentCommentId: cleanParentId,
        text,
      },
      { headers: sessionHeaders() }
    );

    if (!res?.ok) {
      console.log("KRISTO_REPLY_FAILED", { postId: cleanPostId, error: res?.error });
      return { ok: false as const, error: String(res?.error || "Failed to post reply") };
    }

    clearCommentFeedCache(cleanPostId);

    const comment = res?.data?.comment ? normalizeComment(res.data.comment) : null;
    const discussionCount = discussionCountFromPayload(res?.data);
    const returnedCount =
      Number(res?.data?.commentCount || 0) + Number(res?.data?.replyCount || 0);

    console.log("KRISTO_REPLY_SUCCESS", { postId: cleanPostId, parentCommentId: cleanParentId });
    return { ok: true as const, comment, discussionCount, returnedCount };
  } catch (error: any) {
    console.log("KRISTO_REPLY_FAILED", {
      postId: cleanPostId,
      message: String(error?.message || error),
    });
    return { ok: false as const, error: String(error?.message || "Failed to post reply") };
  }
}

export async function toggleFeedCommentLike(commentId: string) {
  const cleanId = String(commentId || "").trim();
  if (!cleanId) return { ok: false as const, error: "Missing comment id" };

  console.log("KRISTO_COMMENT_LIKE_TOGGLE", { commentId: cleanId });

  try {
    const res: any = await apiPost(
      "/api/church/feed",
      { action: "toggle_comment_like", commentId: cleanId },
      { headers: sessionHeaders() }
    );

    if (!res?.ok) {
      console.log("KRISTO_COMMENT_LIKE_FAILED", { commentId: cleanId, error: res?.error });
      return { ok: false as const, error: String(res?.error || "Failed to update like") };
    }

    return {
      ok: true as const,
      commentId: cleanId,
      likedByMe: Boolean(res?.data?.likedByMe),
      likeCount: Number(res?.data?.likeCount || 0),
    };
  } catch (error: any) {
    console.log("KRISTO_COMMENT_LIKE_FAILED", {
      commentId: cleanId,
      message: String(error?.message || error),
    });
    return { ok: false as const, error: String(error?.message || "Failed to update like") };
  }
}

export function patchCommentLikeInTree(
  nodes: FeedCommentNode[],
  commentId: string,
  patch: { likedByMe: boolean; likeCount: number }
): FeedCommentNode[] {
  return nodes.map((node) => {
    if (node.id === commentId) {
      return { ...node, ...patch };
    }
    if (node.replies.length) {
      return {
        ...node,
        replies: patchCommentLikeInTree(node.replies, commentId, patch),
      };
    }
    return node;
  });
}

export function appendRootComment(nodes: FeedCommentNode[], comment: FeedCommentNode) {
  return sortCommentsTree([comment, ...nodes]);
}

export function appendReplyToComment(
  nodes: FeedCommentNode[],
  parentCommentId: string,
  reply: FeedCommentNode
): FeedCommentNode[] {
  return nodes.map((node) => {
    if (node.id === parentCommentId) {
      const replies = [...node.replies, reply].sort(
        (a, b) => commentTimestampMs(a.createdAt) - commentTimestampMs(b.createdAt)
      );
      return {
        ...node,
        replies,
        replyCount: replies.length,
      };
    }
    if (node.replies.length) {
      return {
        ...node,
        replies: appendReplyToComment(node.replies, parentCommentId, reply),
      };
    }
    return node;
  });
}

export function replaceCommentInTree(
  nodes: FeedCommentNode[],
  tempId: string,
  next: FeedCommentNode
): FeedCommentNode[] {
  return nodes.map((node) => {
    if (node.id === tempId) return next;
    if (node.replies.length) {
      return {
        ...node,
        replies: replaceCommentInTree(node.replies, tempId, next),
      };
    }
    return node;
  });
}

export function removeCommentFromTree(nodes: FeedCommentNode[], commentId: string): FeedCommentNode[] {
  const filtered = nodes.filter((node) => node.id !== commentId);
  return filtered.map((node) => {
    if (!node.replies.length) return node;
    const replies = removeCommentFromTree(node.replies, commentId);
    if (replies.length === node.replies.length) return node;
    return { ...node, replies, replyCount: replies.length };
  });
}

export function buildOptimisticComment(postId: string, text: string, parentCommentId?: string) {
  const session = getSessionSync() as any;
  const userId = String(session?.userId || "me").trim();
  const name =
    String(session?.displayName || session?.name || "").trim() || "You";
  const avatar = commentAvatarUrl(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  );

  return {
    id: `optimistic-${Date.now()}`,
    postId: normalizeCommentPostId(postId),
    parentCommentId,
    text,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    authorName: name,
    authorAvatarUri: avatar,
    authorInitial: name.charAt(0).toUpperCase() || "Y",
    likeCount: 0,
    likedByMe: false,
    replyCount: 0,
    replies: [],
  } satisfies FeedCommentNode;
}
