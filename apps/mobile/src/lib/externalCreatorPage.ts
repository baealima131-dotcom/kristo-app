/**
 * The external creator's own page for a Home Feed video link (YouTube / TikTok / Facebook), opened
 * from the link's avatar and name. Never a Kristo screen and never the System Admin who posted the
 * link: with no creator page the tap does nothing.
 *
 * Dependency-free so it can be unit tested in Node (scripts/feedChurchNavigation.test.ts).
 */

/**
 * The YouTube channel page in a saved creatorProfileUrl (https youtube.com /@handle, /channel/ID,
 * /c/name or /user/name), or null. A video, Shorts or any other YouTube page is not a channel.
 */
export function youtubeChannelPageUrl(raw: unknown): string | null {
  try {
    const parsed = new URL(String(raw || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (host !== "youtube.com" && host !== "m.youtube.com") return null;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/(@[A-Za-z0-9._-]{1,100}|channel\/UC[A-Za-z0-9_-]{10,40}|c\/[A-Za-z0-9._-]{1,100}|user\/[A-Za-z0-9._-]{1,100})$/.test(path)) {
      return null;
    }
    return `https://www.youtube.com${path}`;
  } catch {
    return null;
  }
}

function safeHttpsUrl(raw: unknown, hosts: Set<string>): URL | null {
  try {
    const parsed = new URL(String(raw || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    return hosts.has(host) ? parsed : null;
  } catch {
    return null;
  }
}

const TIKTOK_HOSTS = new Set(["tiktok.com", "m.tiktok.com"]);
const TIKTOK_HANDLE = /^@[A-Za-z0-9._]{1,60}$/;

/** TikTok creator page (https://www.tiktok.com/@handle) from the saved profile link or the video link. */
export function tiktokCreatorPageUrl(item: any): string | null {
  for (const raw of [item?.creatorProfileUrl, item?.originalUrl, item?.videoUrl, item?.url]) {
    const parsed = safeHttpsUrl(raw, TIKTOK_HOSTS);
    if (!parsed) continue;
    const handle = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (TIKTOK_HANDLE.test(handle)) return `https://www.tiktok.com/${handle}`;
  }
  return null;
}

const FACEBOOK_HOSTS = new Set(["facebook.com", "m.facebook.com", "web.facebook.com"]);
const FACEBOOK_PAGE = /^[A-Za-z0-9.]{3,80}$/;
/** Path segments that are Facebook sections, never a Page's username. */
const FACEBOOK_NON_PAGE = new Set([
  "watch", "reel", "reels", "share", "video.php", "profile.php", "people", "groups", "pages",
  "plugins", "events", "stories", "photo.php", "permalink.php", "story.php", "login", "home.php",
]);

/**
 * Facebook Page (https://www.facebook.com/<page>) from the saved profile link, or from a
 * /<page> or /<page>/videos/<id> video link. Links that name no Page (/watch, /reel, /share) give null.
 */
export function facebookCreatorPageUrl(item: any): string | null {
  for (const raw of [item?.creatorProfileUrl, item?.originalUrl, item?.videoUrl, item?.url]) {
    const parsed = safeHttpsUrl(raw, FACEBOOK_HOSTS);
    if (!parsed) continue;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const page = parts[0] || "";
    const pageLink = parts.length === 1 || (parts.length >= 3 && parts[1] === "videos");
    if (!pageLink || !FACEBOOK_PAGE.test(page) || FACEBOOK_NON_PAGE.has(page.toLowerCase())) continue;
    return `https://www.facebook.com/${page}`;
  }
  return null;
}

/** The creator page for a video link by platform, or null (the tap then does nothing). */
export function externalCreatorPageUrl(item: any): string | null {
  const platform = String(item?.videoDisplayType || item?.provider || "").trim().toLowerCase();
  if (platform === "youtube") return youtubeChannelPageUrl(item?.creatorProfileUrl);
  if (platform === "tiktok") return tiktokCreatorPageUrl(item);
  if (platform === "facebook") return facebookCreatorPageUrl(item);
  return null;
}
