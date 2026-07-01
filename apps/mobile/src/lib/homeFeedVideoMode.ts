/**
 * Home Feed video presentation mode.
 *
 * V1 uses YouTube-style cards: poster/thumbnail only in the feed; playback opens
 * in a modal on tap. TikTok-style inline auto-play remains available behind the
 * flag for future use — do not delete the player/prime modules.
 */
export const HOME_FEED_YOUTUBE_STYLE_VIDEO = true;

export function isHomeFeedYouTubeStyleVideo(): boolean {
  return HOME_FEED_YOUTUBE_STYLE_VIDEO;
}

/** Metadata-first feed: no eager multi-video prep before the list paints. */
export function isHomeFeedLazyMediaPrewarmEnabled(): boolean {
  return isHomeFeedYouTubeStyleVideo();
}

/** Heavy multi-video frame-gen prewarm — off for YouTube metadata-first cards. */
export function isHomeFeedPosterPrewarmDisabled(): boolean {
  return isHomeFeedYouTubeStyleVideo();
}

/** YouTube Home Feed: lightweight poster cache hydrate + metadata prefetch (not video preload). */
export function isHomeFeedYoutubePosterMetadataEnabled(): boolean {
  return isHomeFeedYouTubeStyleVideo();
}

/** Primary visible row only; +1 when the next row needs a poster while buffering. */
export const HOME_FEED_LAZY_VISIBLE_POSTER_COUNT = 1;
export const HOME_FEED_LAZY_VISIBLE_POSTER_BUFFER = 1;

/** Inline feed players, startup prime, decode-preload, and stuck recovery. */
export function isHomeFeedInlineVideoAutoplayEnabled(): boolean {
  return !HOME_FEED_YOUTUBE_STYLE_VIDEO;
}

/** Disk-cache feed videos for fast Watch open (YouTube tap-to-play) or inline playback. */
export function isHomeFeedVideoDiskCacheEnabled(): boolean {
  return true;
}

export type HomeFeedVideoOpenPayload = {
  postId: string;
  title: string;
  videoUri: string;
  posterUri?: string;
  videoDurationMs?: number;
  videoDisplayType?: "youtube" | "tiktok";
  /** Full feed row — preserves church, caption, and engagement metadata on Watch Screen. */
  item: any;
};
