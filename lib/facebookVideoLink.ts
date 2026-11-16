/**
 * Public Facebook video / Reel links: recognise the URL shapes people paste, then confirm the
 * video through Meta's official oEmbed endpoint (graph.facebook.com/oembed_video). Nothing is
 * scraped from facebook.com. Private, deleted or unknown videos are not confirmed by oEmbed and
 * are rejected.
 *
 * Keep the URL rules in sync with apps/mobile/src/lib/facebookVideoLink.ts.
 */

export type FacebookVideoLinkKind = "video" | "reel" | "share";

export type ParsedFacebookVideoLink = {
  kind: FacebookVideoLinkKind;
  /** Numeric video id when the URL carries one (share links do not). */
  videoId: string | null;
  /** The link with tracking parameters removed. */
  url: string;
  /** Reels and /share/r/ links are vertical videos. */
  vertical: boolean;
};

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"]);
const FB_WATCH_HOSTS = new Set(["fb.watch", "www.fb.watch"]);
const VIDEO_ID = /^\d{5,25}$/;
const SHARE_CODE = /^[A-Za-z0-9_-]{4,40}$/;
const PAGE_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

export function isFacebookVideoHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase();
  return FACEBOOK_HOSTS.has(host) || FB_WATCH_HOSTS.has(host);
}

export function parseFacebookVideoUrl(raw: unknown): ParsedFacebookVideoLink | null {
  const value = String(raw || "").trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (FB_WATCH_HOSTS.has(host)) {
    const code = parts[0] || "";
    if (parts.length !== 1 || !SHARE_CODE.test(code)) return null;
    return { kind: "share", videoId: null, url: `https://fb.watch/${code}/`, vertical: false };
  }
  if (!FACEBOOK_HOSTS.has(host)) return null;

  // /reel/{id}
  if (parts[0] === "reel" && parts.length === 2 && VIDEO_ID.test(parts[1])) {
    return { kind: "reel", videoId: parts[1], url: `https://www.facebook.com/reel/${parts[1]}`, vertical: true };
  }
  // /watch?v={id}, /watch/?v={id}, /video.php?v={id}
  if ((parts.length === 1 && (parts[0] === "watch" || parts[0] === "video.php"))) {
    const id = url.searchParams.get("v") || "";
    if (!VIDEO_ID.test(id)) return null;
    return { kind: "video", videoId: id, url: `https://www.facebook.com/watch/?v=${id}`, vertical: false };
  }
  // /share/v/{code} (video) and /share/r/{code} (reel)
  if (parts[0] === "share" && parts.length === 3 && (parts[1] === "v" || parts[1] === "r") && SHARE_CODE.test(parts[2])) {
    return {
      kind: "share",
      videoId: null,
      url: `https://www.facebook.com/share/${parts[1]}/${parts[2]}/`,
      vertical: parts[1] === "r",
    };
  }
  // /{page}/videos/{id} and /{page}/videos/{slug-or-vb.xxx}/{id}
  if (
    parts.length >= 3 &&
    parts.length <= 4 &&
    parts[1] === "videos" &&
    PAGE_SEGMENT.test(parts[0]) &&
    VIDEO_ID.test(parts[parts.length - 1]) &&
    (parts.length === 3 || PAGE_SEGMENT.test(parts[2]))
  ) {
    const id = parts[parts.length - 1];
    return {
      kind: "video",
      videoId: id,
      url: `https://www.facebook.com/${parts[0]}/videos/${id}/`,
      vertical: false,
    };
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export type FacebookOEmbedVideo = {
  /** Permanent link Facebook reports for the public video (blockquote cite). */
  canonicalUrl: string;
  videoId: string | null;
  vertical: boolean;
  title: string;
  creatorName: string;
  creatorProfileUrl: string | null;
  publishedAt: string | null;
};

/**
 * Read the official oEmbed `html`. Facebook only fills the citation block (permalink, title,
 * page, date) for a video it can show publicly; an empty `<div class="fb-video">` means the
 * video is private, removed or does not exist.
 */
export function parseFacebookOEmbedHtml(html: unknown, input: ParsedFacebookVideoLink): FacebookOEmbedVideo | null {
  const value = String(html || "");
  const quote = value.match(/<blockquote\b[^>]*\bcite="([^"]+)"[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (!quote) return null;
  const canonical = parseFacebookVideoUrl(decodeHtmlEntities(quote[1]));
  if (!canonical || canonical.kind === "share" || !canonical.videoId) return null;
  const body = quote[2];

  const title = stripTags(body.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
  const posted = body.match(/Posted by\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*on\s*([^<]+)/i);
  let creatorProfileUrl: string | null = null;
  if (posted) {
    try {
      const profile = new URL(decodeHtmlEntities(posted[1]));
      if (profile.protocol === "https:" && FACEBOOK_HOSTS.has(profile.hostname.toLowerCase())) {
        creatorProfileUrl = `https://www.facebook.com${profile.pathname}`;
      }
    } catch {}
  }
  // "Friday, December 5, 2014" is a calendar date: store it at noon UTC so no timezone shifts the day.
  const parsedDate = posted ? new Date(Date.parse(stripTags(posted[3]))) : null;
  const publishedMs = parsedDate && Number.isFinite(parsedDate.getTime())
    ? Date.UTC(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 12)
    : NaN;

  return {
    canonicalUrl: canonical.url,
    videoId: canonical.videoId,
    vertical: canonical.vertical || input.vertical,
    title,
    creatorName: posted ? stripTags(posted[2]) : "",
    creatorProfileUrl,
    publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
  };
}

/** Confirm a public Facebook video through the official oEmbed endpoint. */
export async function fetchFacebookOEmbedVideo(
  input: ParsedFacebookVideoLink,
  options: { timeoutMs?: number; accessToken?: string } = {}
): Promise<FacebookOEmbedVideo | null> {
  const endpoint = new URL("https://graph.facebook.com/v27.0/oembed_video");
  // oEmbed returns an empty embed for /reel/{id} URLs even when the Reel is public, but
  // confirms the same video asked as /watch/?v={id} (its citation then points at /reel/{id}/).
  const lookupUrl = input.kind === "reel" && input.videoId
    ? `https://www.facebook.com/watch/?v=${input.videoId}`
    : input.url;
  endpoint.searchParams.set("url", lookupUrl);
  endpoint.searchParams.set("omitscript", "true");
  // Tokenless access is allowed (rate limited); an approved app token raises the limit.
  const token = String(options.accessToken || "").trim();
  if (token) endpoint.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs || 9000));
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    // Captions can carry raw control characters (and occasionally invalid UTF-8, which
    // text() replaces) that strict JSON parsing rejects.
    const raw = await response.text().catch(() => "");
    let body: any = null;
    try {
      body = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      body = null;
    }
    if (!response.ok || !body || body.type !== "video") return null;
    return parseFacebookOEmbedHtml(body.html, input);
  } finally {
    clearTimeout(timer);
  }
}
