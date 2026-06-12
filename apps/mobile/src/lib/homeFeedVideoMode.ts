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

/** Inline feed players, startup prime, decode-preload, and stuck recovery. */
export function isHomeFeedInlineVideoAutoplayEnabled(): boolean {
  return !HOME_FEED_YOUTUBE_STYLE_VIDEO;
}

export type HomeFeedVideoOpenPayload = {
  postId: string;
  title: string;
  videoUri: string;
  posterUri?: string;
  videoDurationMs?: number;
};
