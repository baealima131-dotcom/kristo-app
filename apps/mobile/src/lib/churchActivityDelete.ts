import { belongsToChurch, getPostAuthorId } from "./churchActivityPosts";
import { isPastorOrAdminRole } from "./churchStoragePosts";

export type ChurchActivityDeleteAccess = {
  isActualChurchPastor?: boolean;
  isMediaHost?: boolean;
  actualPastorUserId?: string;
};

export function isPastorOrAdminAuthoredFeedPost(
  item: any,
  options?: { actualPastorUserId?: string }
): boolean {
  const authorId = getPostAuthorId(item);
  const actualPastorUserId = String(options?.actualPastorUserId || "").trim();
  if (actualPastorUserId && authorId === actualPastorUserId) return true;

  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "church") return true;

  const authorRole = String(
    item?.authorRole || item?.postedByRole || item?.actorRole || item?.role || ""
  )
    .trim()
    .toLowerCase();
  if (authorRole.includes("pastor") || authorRole.includes("admin")) return true;

  return false;
}

export function canDeleteChurchActivityPost(
  post: any,
  args: {
    churchId: string;
    userId: string;
    role?: string;
    access?: ChurchActivityDeleteAccess;
    isCurrentMember?: boolean;
  }
): boolean {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!post || !churchId || !userId) return false;

  if (!belongsToChurch(post, churchId)) return false;

  if (args.isCurrentMember === false) return false;

  const access = args.access || {};
  const actualPastorUserId = String(access.actualPastorUserId || "").trim();
  const isPastor =
    isPastorOrAdminRole(args.role) ||
    Boolean(access.isActualChurchPastor) ||
    Boolean(actualPastorUserId && actualPastorUserId === userId);

  if (isPastor) return true;

  const isTrustedHost = Boolean(access.isMediaHost);
  const authorId = getPostAuthorId(post);
  const isPastorAdminPost = isPastorOrAdminAuthoredFeedPost(post, { actualPastorUserId });

  if (isTrustedHost && !isPastorAdminPost) return true;

  if (authorId && authorId === userId) return true;

  return false;
}

export function canDeleteChurchActivityPostFromSession(
  post: any,
  session: { userId?: string; role?: string; churchId?: string; churchRole?: string } | null | undefined,
  access: ChurchActivityDeleteAccess,
  churchId: string
): boolean {
  const sessionChurchId = String(session?.churchId || "").trim();
  const resolvedChurchId = String(churchId || sessionChurchId || "").trim();

  return canDeleteChurchActivityPost(post, {
    churchId: resolvedChurchId,
    userId: String(session?.userId || "").trim(),
    role: String(session?.role || session?.churchRole || "").trim() || undefined,
    access,
    isCurrentMember: Boolean(
      resolvedChurchId && sessionChurchId && sessionChurchId === resolvedChurchId
    ),
  });
}

export function parseChurchActivityDeleteResponse(res: any, postId: string) {
  const payload = res?.data && typeof res.data === "object" ? res.data : res;
  const deletedId = String(payload?.postId || res?.postId || postId || "").trim();
  const deleted =
    res?.ok !== false &&
    !res?.error &&
    (payload?.deleted === true || res?.deleted === true);

  return {
    deleted,
    deletedId,
    status: Number(res?.status || 0),
    error: String(res?.error || "").trim(),
    payload,
  };
}
