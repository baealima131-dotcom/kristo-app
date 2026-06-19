import {
  homeFeedMediaUrl,
  isImagePost,
  isVideoPost,
  resolveBestFeedPosterUri,
  resolvePostImageUri,
  resolveVideoUri,
} from "@/components/homeFeed/homeFeedUtils";
import type { ChurchPublicPost } from "@/lib/churchProfileApi";

export function churchPublicPostToFeedItem(post: ChurchPublicPost): Record<string, unknown> {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    type: post.type,
    mediaType: post.mediaType,
    videoUri: post.videoUrl,
    videoUrl: post.videoUrl,
    mediaUri: post.mediaUri || post.imageUrl,
    imageUrl: post.imageUrl,
    imageUri: post.imageUri,
    photoUrl: post.photoUrl,
    posterUri: post.posterUri,
    videoPosterUri: post.videoPosterUri,
    thumbnailUri: post.thumbnailUri,
    thumbnailUrl: post.thumbnailUrl,
    posterUrl: post.posterUrl,
    coverUrl: post.coverUrl,
    coverImageUrl: post.coverImageUrl,
    images: post.images,
    attachments: post.attachments,
    mediaUrls: post.mediaUrls,
  };
}

export function resolveChurchPublicPostCover(post: ChurchPublicPost): string {
  const serverCover = homeFeedMediaUrl(post.coverUri);
  if (serverCover) return serverCover;

  const item = churchPublicPostToFeedItem(post);
  const postId = String(post.id || "").trim();

  if (isVideoPost(item)) {
    const poster = resolveBestFeedPosterUri(item, postId);
    if (poster) return poster;
  }

  if (isImagePost(item)) {
    const image = resolvePostImageUri(item);
    if (image) return image;
  }

  const image = resolvePostImageUri(item);
  if (image) return image;

  const video = resolveVideoUri(item);
  if (video) {
    const poster = resolveBestFeedPosterUri(item, postId);
    if (poster) return poster;
  }

  for (const raw of [
    post.coverUrl,
    post.coverImageUrl,
    post.thumbnailUrl,
    post.posterUrl,
    post.imageUrl,
    post.mediaUri,
  ]) {
    const uri = homeFeedMediaUrl(raw);
    if (uri && !/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(uri)) return uri;
  }

  return "";
}

export function churchPublicPostIsVideo(post: ChurchPublicPost): boolean {
  return isVideoPost(churchPublicPostToFeedItem(post));
}
