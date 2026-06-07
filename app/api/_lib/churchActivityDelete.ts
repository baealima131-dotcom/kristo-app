import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { resolveChurchPastorUserId } from "@/app/api/_lib/churchPastor";

export type ChurchActivityDeleteContext = {
  churchId: string;
  userId: string;
  role?: unknown;
  isTrustedHost?: boolean;
  actualPastorUserId?: string;
  /** When false, delete is denied (e.g. former member). Defaults to true for server callers after guard(). */
  isCurrentMember?: boolean;
};

export function getFeedPostAuthorId(item: any): string {
  return String(
    item?.createdBy ||
      item?.actorUserId ||
      item?.authorId ||
      item?.userId ||
      item?.postedByUserId ||
      ""
  ).trim();
}

export function isPastorOrAdminRole(role: unknown): boolean {
  const value = String(role || "").trim().toLowerCase();
  return value.includes("pastor") || value.includes("admin");
}

export function isPastorOrAdminAuthoredFeedPost(
  item: any,
  options?: { actualPastorUserId?: string }
): boolean {
  const authorId = getFeedPostAuthorId(item);
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
  item: any,
  ctx: ChurchActivityDeleteContext
): boolean {
  const itemChurchId = String(item?.churchId || "").trim();
  const churchId = String(ctx.churchId || "").trim();
  const userId = String(ctx.userId || "").trim();

  if (!itemChurchId || !churchId || itemChurchId !== churchId) return false;
  if (!userId) return false;

  if (ctx.isCurrentMember === false) return false;

  const actualPastorUserId = String(ctx.actualPastorUserId || "").trim();
  const isPastor =
    isPastorOrAdminRole(ctx.role) ||
    Boolean(actualPastorUserId && actualPastorUserId === userId);

  if (isPastor) return true;

  const isTrustedHost = Boolean(ctx.isTrustedHost);
  const authorId = getFeedPostAuthorId(item);
  const isPastorAdminPost = isPastorOrAdminAuthoredFeedPost(item, { actualPastorUserId });

  if (isTrustedHost && !isPastorAdminPost) return true;

  if (authorId && authorId === userId) return true;

  return false;
}

export async function resolveCanDeleteChurchActivityPost(
  item: any,
  args: { churchId: string; userId: string; role: unknown }
): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!churchId || !userId) return false;

  const [pastorResolution, mediaAccess] = await Promise.all([
    resolveChurchPastorUserId(churchId),
    evaluateChurchMediaAccess({ churchId, userId }),
  ]);

  const actualPastorUserId = String(pastorResolution.actualChurchPastorUserId || "").trim();

  return canDeleteChurchActivityPost(item, {
    churchId,
    userId,
    role: args.role,
    isTrustedHost: mediaAccess.isMediaHost,
    actualPastorUserId,
    isCurrentMember: true,
  });
}
