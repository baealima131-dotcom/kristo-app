export type YouTubePublicComment = {
  id: string;
  authorName: string;
  authorAvatarUrl: string;
  authorChannelUrl: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  replyCount: number;
};

export type YouTubePublicCommentsResult = {
  comments: YouTubePublicComment[];
  commentsDisabled: boolean;
};

/** Fetch at most 100 public top-level comments for one video using YouTube's official API. */
export async function fetchYouTubePublicComments(
  videoId: string,
  apiKey: string
): Promise<YouTubePublicCommentsResult> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid YouTube video id.");

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  endpoint.search = new URLSearchParams({
    part: "snippet",
    videoId,
    maxResults: "100",
    order: "relevance",
    textFormat: "plainText",
    key: apiKey,
  }).toString();

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const body: any = await response.json().catch(() => null);

  if (!response.ok) {
    const reason = String(body?.error?.errors?.[0]?.reason || "");
    if (reason === "commentsDisabled" || reason === "disabledComments") {
      return { comments: [], commentsDisabled: true };
    }
    throw new Error(response.status === 403
      ? "YouTube comments request was forbidden."
      : "YouTube comments request failed.");
  }

  const comments = (Array.isArray(body?.items) ? body.items : []).flatMap((thread: any) => {
    const comment = thread?.snippet?.topLevelComment;
    const snippet = comment?.snippet;
    const text = String(snippet?.textDisplay || snippet?.textOriginal || "").trim();
    const id = String(comment?.id || "").trim();
    if (!id || !text) return [];
    const avatar = String(snippet?.authorProfileImageUrl || "").trim();
    const channel = String(snippet?.authorChannelUrl || "").trim();
    const likeCount = Number(snippet?.likeCount);
    const replyCount = Number(thread?.snippet?.totalReplyCount);
    return [{
      id: id.slice(0, 256),
      authorName: String(snippet?.authorDisplayName || "YouTube user").slice(0, 120),
      authorAvatarUrl: /^https:\/\//i.test(avatar) ? avatar.slice(0, 2048) : "",
      authorChannelUrl: /^https:\/\/(www\.)?youtube\.com\//i.test(channel) ? channel.slice(0, 2048) : "",
      text: text.slice(0, 1500),
      publishedAt: String(snippet?.publishedAt || "").slice(0, 40),
      likeCount: Number.isSafeInteger(likeCount) && likeCount >= 0 ? likeCount : 0,
      replyCount: Number.isSafeInteger(replyCount) && replyCount >= 0 ? replyCount : 0,
    }];
  });

  return { comments: comments.slice(0, 100), commentsDisabled: false };
}
