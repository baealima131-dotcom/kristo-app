import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { normalizeCommentPostId } from "@/src/lib/homeFeedComments";
import { ENV, resolveApiBase } from "@/src/lib/kristoEnv";
import type { SharedContentPayload } from "@/src/lib/messagesStore";

const WEB_SHARE_BASE = String(
  process.env.EXPO_PUBLIC_WEB_SHARE_BASE || "https://kristo-app.vercel.app"
).replace(/\/+$/, "");
const DEEP_LINK_SCHEME = String(process.env.EXPO_PUBLIC_DEEP_LINK_SCHEME || "mobile").trim() || "mobile";

export type HomeFeedSharePayload = {
  postId: string;
  title: string;
  churchName: string;
  posterUri: string;
  videoUri: string;
  shareUrl: string;
};

function isLocalDevApiBase(base: string) {
  return /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\./i.test(base);
}

/** Public web link in prod; deep link fallback when running against local API. */
export function buildHomeFeedPostShareUrl(postId: string): string {
  const cleanId = normalizeCommentPostId(String(postId || "").trim());
  if (!cleanId) return "";

  if (typeof __DEV__ !== "undefined" && __DEV__ && isLocalDevApiBase(resolveApiBase())) {
    return `${DEEP_LINK_SCHEME}://post/${encodeURIComponent(cleanId)}`;
  }

  const webBase = String(process.env.EXPO_PUBLIC_WEB_SHARE_BASE || "").trim() || ENV.WEB_BASE;
  const normalizedWebBase = webBase.replace(/\/+$/, "");
  if (normalizedWebBase && !normalizedWebBase.includes("localhost")) {
    return `${normalizedWebBase}/post/${encodeURIComponent(cleanId)}`;
  }

  return `${WEB_SHARE_BASE}/post/${encodeURIComponent(cleanId)}`;
}

export function buildHomeFeedSharePayload(item: any): HomeFeedSharePayload | null {
  const postId = normalizeCommentPostId(String(item?.id || "").trim());
  if (!postId) return null;

  const title = String(
    item?.title || item?.videoTitle || item?.body || item?.text || ""
  ).trim();
  const churchName = String(item?.churchName || item?.churchLabel || "").trim();
  const posterUri = String(
    item?.posterUri || item?.videoPosterUri || item?.thumbnailUri || item?.posterUrl || ""
  ).trim();
  const videoUri = String(
    item?.videoUri || item?.mediaUrl || item?.url || item?.playbackUrl || ""
  ).trim();
  const shareUrl = buildHomeFeedPostShareUrl(postId);
  if (!shareUrl) return null;

  return {
    postId,
    title,
    churchName,
    posterUri,
    videoUri,
    shareUrl,
  };
}

export function buildSharedContentPayload(
  payload: HomeFeedSharePayload,
  item?: any
): SharedContentPayload {
  const mediaKind = String(item?.mediaKind || item?.postKind || item?.kind || "").trim().toLowerCase();
  let type: SharedContentPayload["type"] = payload.videoUri ? "video" : "post";
  if (mediaKind.includes("announcement")) type = "announcement";
  else if (mediaKind.includes("testimony")) type = "testimony";
  else if (mediaKind.includes("live")) type = "live";
  else if (mediaKind.includes("image")) type = "image";

  const authorName = String(
    item?.authorName || item?.actorLabel || item?.displayName || ""
  ).trim();

  return {
    type,
    postId: payload.postId,
    title: payload.title,
    caption: payload.title,
    churchName: payload.churchName,
    authorName: authorName || undefined,
    posterUri: payload.posterUri || undefined,
    videoUri: payload.videoUri || undefined,
    shareUrl: payload.shareUrl,
  };
}

export function buildHomeFeedExternalShareMessage(payload: HomeFeedSharePayload): string {
  const title = String(payload.title || "Kristo").trim() || "Kristo";
  return `${title}\nShared from Kristo App`;
}

export async function shareHomeFeedPostExternally(payload: HomeFeedSharePayload): Promise<void> {
  const postTitle = String(payload.title || "Kristo").trim() || "Kristo";
  const shareUrl = String(payload.shareUrl || "").trim();
  const shareMessage = buildHomeFeedExternalShareMessage(payload);

  console.log("KRISTO_EXTERNAL_SHARE_START", {
    postId: payload.postId,
    shareUrl,
  });

  try {
    const result = await Share.share({
      title: postTitle,
      message: shareMessage,
      url: shareUrl || undefined,
    });

    if (result.action === Share.dismissedAction) {
      console.log("KRISTO_EXTERNAL_SHARE_CANCELLED", {
        postId: payload.postId,
      });
      return;
    }

    if (result.action === Share.sharedAction) {
      console.log("KRISTO_EXTERNAL_SHARE_SUCCESS", {
        postId: payload.postId,
        activityType: String((result as { activityType?: string }).activityType || ""),
      });
    }
  } catch (error) {
    console.log("KRISTO_EXTERNAL_SHARE_ERROR", {
      postId: payload.postId,
      error: String((error as Error)?.message || error),
    });
    throw error;
  }
}

export async function copyHomeFeedPostShareLink(payload: HomeFeedSharePayload): Promise<boolean> {
  if (!payload.shareUrl) return false;
  await Clipboard.setStringAsync(payload.shareUrl);
  return true;
}
