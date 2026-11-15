/**
 * Public Facebook video / Reel links in the app. URL rules are the same as the server's
 * lib/facebookVideoLink.ts (keep them in sync); the server confirms each video through Meta's
 * official oEmbed before it is published, and Watch plays it with Facebook's official
 * Embedded Video Player plugin. Nothing is scraped.
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

/** Post saved from a Facebook link (system admin video link with provider "facebook"). */
export function isFacebookVideoLinkItem(item: any): boolean {
  if (String(item?.source || "").trim().toLowerCase() !== "system-admin-video-link") return false;
  const platform = String(item?.videoDisplayType || item?.provider || "").trim().toLowerCase();
  if (platform) return platform === "facebook";
  // A row without its platform (e.g. from an older cache): recognise the Facebook link itself.
  return Boolean(parseFacebookVideoUrl(item?.videoUrl || item?.url));
}

/** Facebook Reels are vertical; other Facebook videos use the landscape frame. */
export function isVerticalFacebookVideoItem(item: any): boolean {
  if (!isFacebookVideoLinkItem(item)) return false;
  const orientation = String(item?.videoOrientation || "").trim().toLowerCase();
  if (orientation) return orientation === "vertical";
  return Boolean(parseFacebookVideoUrl(item?.videoUrl || item?.url)?.vertical);
}

/** The link to open in Facebook: the one that was pasted, else the confirmed permalink. */
export function facebookOpenUrl(item: any): string | null {
  for (const raw of [item?.originalUrl, item?.videoUrl, item?.url]) {
    const parsed = parseFacebookVideoUrl(raw);
    if (parsed) return parsed.url;
  }
  return null;
}

/** Official Embedded Video Player plugin URL for a confirmed public Facebook video. */
export function buildFacebookEmbedPluginUrl(
  item: any,
  size: { width: number; height: number },
  options: { autoplay?: boolean } = {}
): string | null {
  const parsed = parseFacebookVideoUrl(item?.videoUrl || item?.url);
  if (!parsed || parsed.kind === "share" || !parsed.videoId) return null;
  const params = new URLSearchParams({
    href: parsed.url,
    show_text: "false",
    width: String(Math.max(220, Math.round(size.width))),
    height: String(Math.max(120, Math.round(size.height))),
    autoplay: options.autoplay === false ? "false" : "true",
    allowfullscreen: "true",
  });
  return `https://www.facebook.com/plugins/video.php?${params.toString()}`;
}

/** Page hosting the plugin iframe full-size, so the player fills Watch's 4:5 or 16:9 frame. */
export function buildFacebookEmbedHtml(pluginUrl: string): string {
  const src = pluginUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe src="${src}" scrolling="no" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen="true"></iframe></body></html>`;
}

/** Hosts Facebook's player may load in its own frame. */
export function isFacebookPlayerHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase();
  return host === "facebook.com" || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net") || host === "fb.watch";
}

function facebookCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

/**
 * Platform counts to show next to Kristo's own engagement for an external video link.
 *
 * Facebook: a count Meta's Graph API returned (platformStats) wins; when Graph has none, the
 * count a System Admin entered from Facebook (facebookManualStats) is used; otherwise it stays
 * empty. Every other post returns its platformStats unchanged.
 */
export function resolveExternalPlatformStats(item: any): Record<string, unknown> {
  const raw = item?.platformStats ?? item?.stats ?? {};
  const platform = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!isFacebookVideoLinkItem(item)) return platform;
  const manualRaw = item?.facebookManualStats;
  const manual = manualRaw && typeof manualRaw === "object" ? manualRaw : {};
  return {
    views: facebookCount(platform.views),
    likes: facebookCount(platform.likes) ?? facebookCount(manual.likes),
    comments: facebookCount(platform.comments) ?? facebookCount(manual.comments),
  };
}

/** Shown instead of a count the platform withholds on purpose (YouTube: likes hidden, comments off). */
export const PLATFORM_COUNT_HIDDEN_LABEL = "Imefichwa";

/**
 * Which counts the platform withholds on purpose for an external video link (saved by the server as
 * platformHiddenFields). Missing counts for other reasons (no API key, lookup failed) are not "hidden".
 */
export function externalPlatformHiddenCounts(item: any): { likes: boolean; comments: boolean } {
  const raw: unknown[] = Array.isArray(item?.platformHiddenFields) ? item.platformHiddenFields : [];
  const fields = raw.map((value) => String(value || "").trim().toLowerCase());
  return { likes: fields.includes("likes"), comments: fields.includes("comments") };
}

/**
 * Label for a like/comment count: when the platform hides its count and nobody on Kristo has
 * added any, say it is hidden instead of showing 0. Kristo's own likes/comments still show.
 */
export function externalCountLabel(count: number, hidden: boolean, format: (value: number) => string): string {
  return hidden && count <= 0 ? PLATFORM_COUNT_HIDDEN_LABEL : format(count);
}

/**
 * Facebook posts can be years old: when the post date is from an earlier calendar year, show the
 * year too ("Dec 5, 2014"). Returns "" for this year's posts (the usual feed label applies) and for
 * missing or invalid dates.
 */
export function formatFacebookOlderYearDate(publishedAt: unknown, now: Date = new Date()): string {
  const ms = Date.parse(String(publishedAt || ""));
  if (!Number.isFinite(ms)) return "";
  const posted = new Date(ms);
  if (posted.getFullYear() >= now.getFullYear()) return "";
  return posted.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The cover a System Admin uploaded for a Facebook link (facebookCoverUrl), or "" when there is
 * none. Release builds accept https only; development builds also accept a local http test server.
 */
export function facebookAdminCoverUri(item: any): string {
  if (!isFacebookVideoLinkItem(item)) return "";
  const value = String(item?.facebookCoverUrl || "").trim();
  if (/^https:\/\//i.test(value)) return value;
  if (typeof __DEV__ !== "undefined" && __DEV__ && /^http:\/\//i.test(value)) return value;
  return "";
}
