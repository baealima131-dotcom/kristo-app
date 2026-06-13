import { getFeedItemById, type ChurchFeedItem } from "@/app/api/_lib/store/feedDb";
import { isUsableVideoPosterUri } from "@/app/api/_lib/media/videoPoster";

const DEFAULT_SHARE_WEB_BASE = "https://kristo.app";
const DEFAULT_DEEP_LINK_SCHEME = "mobile";

export type SharePostPreview = {
  postId: string;
  found: boolean;
  title: string;
  description: string;
  churchName: string;
  authorName: string;
  type: string;
  imageUrl: string;
  shareUrl: string;
  deepLinkUrl: string;
};

export function normalizeSharePostId(input: unknown): string {
  const id = String(input || "")
    .replace(/__fy_\d+$/g, "")
    .trim();
  if (!id) return "";
  return id.split("__slot_")[0];
}

export function getShareWebBase(): string {
  const fromEnv = String(process.env.NEXT_PUBLIC_WEB_SHARE_BASE || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const vercel = String(process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return DEFAULT_SHARE_WEB_BASE;
}

export function getDeepLinkScheme(): string {
  return String(process.env.KRISTO_DEEP_LINK_SCHEME || DEFAULT_DEEP_LINK_SCHEME).trim() || DEFAULT_DEEP_LINK_SCHEME;
}

export function buildPostSharePageUrl(postId: string): string {
  const cleanId = normalizeSharePostId(postId);
  if (!cleanId) return "";
  return `${getShareWebBase()}/post/${encodeURIComponent(cleanId)}`;
}

export function buildPostDeepLinkUrl(postId: string): string {
  const cleanId = normalizeSharePostId(postId);
  if (!cleanId) return "";
  return `${getDeepLinkScheme()}://post/${encodeURIComponent(cleanId)}`;
}

function isDeletedFeedItem(item: ChurchFeedItem | null | undefined): boolean {
  if (!item) return true;
  if (item.deleted === true) return true;
  if (String(item.deletedAt || "").trim()) return true;
  const status = String(item.status || item.scheduleStatus || "")
    .trim()
    .toLowerCase();
  return status === "deleted";
}

export function resolveShareAssetUrl(uri: unknown, webBase = getShareWebBase()): string {
  const value = String(uri || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${webBase.replace(/\/+$/, "")}${value}`;
  return "";
}

function pickPosterUri(item: ChurchFeedItem): string {
  const videoUrl = String(item.videoUrl || item.mediaUri || "").trim();
  const candidates = [
    item.posterUri,
    item.videoPosterUri,
    item.thumbnailUri,
    item.thumbnailUrl,
    item.posterUrl,
    item.mediaUri,
    item.churchAvatarUri,
    item.avatarUri,
  ];

  for (const candidate of candidates) {
    const uri = String(candidate || "").trim();
    if (!uri) continue;
    if (isUsableVideoPosterUri(uri, videoUrl)) return uri;
  }

  return "";
}

function buildDescription(item: ChurchFeedItem | null, churchName: string): string {
  if (!item) {
    return "Open this post in the Kristo App.";
  }

  const text = String(item.text || item.title || "").trim();
  if (text) return text.length > 180 ? `${text.slice(0, 177)}…` : text;

  const church = churchName || String(item.churchName || item.churchLabel || "").trim();
  if (church) return `Shared from ${church} on Kristo App.`;
  return "Shared from Kristo App.";
}

export function buildSharePostPreviewFromItem(
  postId: string,
  item: ChurchFeedItem | null
): SharePostPreview {
  const cleanId = normalizeSharePostId(postId);
  const shareUrl = buildPostSharePageUrl(cleanId);
  const deepLinkUrl = buildPostDeepLinkUrl(cleanId);
  const webBase = getShareWebBase();

  if (!item || isDeletedFeedItem(item)) {
    return {
      postId: cleanId,
      found: false,
      title: "Kristo App",
      description: "Open this post in the Kristo App.",
      churchName: "",
      authorName: "",
      type: "post",
      imageUrl: "",
      shareUrl,
      deepLinkUrl,
    };
  }

  const title =
    String(item.title || item.mediaName || item.text || "").trim() || "Kristo post";
  const churchName = String(item.churchName || item.churchLabel || "").trim();
  const authorName = String(item.actorLabel || "").trim();
  const type = String(item.type || "post").trim();
  const posterUri = pickPosterUri(item);
  const imageUrl = resolveShareAssetUrl(posterUri, webBase);

  return {
    postId: cleanId,
    found: true,
    title,
    description: buildDescription(item, churchName),
    churchName,
    authorName,
    type,
    imageUrl,
    shareUrl,
    deepLinkUrl,
  };
}

export async function loadSharePostPreview(postId: string): Promise<SharePostPreview> {
  const cleanId = normalizeSharePostId(postId);
  if (!cleanId) {
    return buildSharePostPreviewFromItem("", null);
  }

  const item = await getFeedItemById(cleanId);
  return buildSharePostPreviewFromItem(cleanId, item);
}
