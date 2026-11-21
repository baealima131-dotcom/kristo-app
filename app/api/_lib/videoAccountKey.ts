/**
 * Identity of the YouTube / TikTok / Facebook account behind a System Admin video-link post.
 *
 * Saved posts carry `creatorId` / `creatorProfileUrl` in different shapes depending on how the
 * metadata was read:
 * - YouTube Data API: channel id "UC…" (profile URL …/channel/UC…)
 * - YouTube oEmbed:   handle URL https://www.youtube.com/@handle
 * - TikTok oEmbed:    https://www.tiktok.com/@user
 * - Facebook:         profile / page URL
 * The key normalizes those; YouTube channel-id and handle posts of the same channel are matched
 * by channel name (they cannot be compared directly without the YouTube API).
 *
 * KEEP IN SYNC with apps/mobile/src/lib/videoAccountKey.ts (scripts/videoAccountOverview.test.ts
 * checks both give the same keys).
 */

export type VideoAccountIdentity = {
  /** "" when the post has no account id, profile URL or name (the profile is not clickable). */
  key: string;
  provider: string;
  name: string;
  /** "strong" = channel id / handle / profile URL; "name" = only the display name is known. */
  kind: "strong" | "name" | "none";
};

const PROVIDERS = new Set(["youtube", "tiktok", "facebook"]);

const PLATFORM_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "www.facebook.com",
  "facebook.com",
  "m.facebook.com",
  "fb.watch",
]);

/** Same visibility as the Home Feed for video links (deleted / hidden / invalid links stay out). */
export function isVisibleVideoLinkItem(item: any): boolean {
  if (String(item?.source || "") !== "system-admin-video-link") return false;
  if (item?.deleted === true) return false;
  if (String(item?.status || item?.scheduleStatus || "").trim().toLowerCase() === "deleted") return false;
  if (item?.hiddenByReports === true || item?.hiddenBySystemAdmin === true) return false;
  const mediaStatus = String(item?.mediaStatus || "").trim().toLowerCase();
  if (mediaStatus && mediaStatus !== "ready") return false;
  try {
    const url = new URL(String(item?.videoUrl || "").trim());
    return url.protocol === "https:" && PLATFORM_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function normalizeVideoAccountName(raw: unknown): string {
  return String(raw || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function providerOf(item: any): string {
  const raw = String(item?.videoDisplayType || item?.provider || "").trim().toLowerCase();
  return PROVIDERS.has(raw) ? raw : "video";
}

function parseUrl(raw: unknown): URL | null {
  const text = String(raw || "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function youtubeStrongKey(creatorId: string, profileUrl: string): string {
  for (const raw of [creatorId, profileUrl]) {
    if (/^UC[\w-]{20,}$/.test(raw)) return `youtube:channel:${raw}`;
    const url = parseUrl(raw);
    if (!url) continue;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1] && /^UC[\w-]{20,}$/.test(parts[1])) return `youtube:channel:${parts[1]}`;
    if (parts[0]?.startsWith("@") && parts[0].length > 1) return `youtube:${decodeURIComponent(parts[0]).toLowerCase()}`;
    if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return `youtube:${parts[0]}:${decodeURIComponent(parts[1]).toLowerCase()}`;
  }
  return "";
}

function tiktokStrongKey(creatorId: string, profileUrl: string): string {
  for (const raw of [creatorId, profileUrl]) {
    const url = parseUrl(raw);
    const first = url?.pathname.split("/").filter(Boolean)[0] || "";
    if (first.startsWith("@") && first.length > 1) return `tiktok:${decodeURIComponent(first).toLowerCase()}`;
  }
  return "";
}

function facebookStrongKey(creatorId: string, profileUrl: string): string {
  for (const raw of [profileUrl, creatorId]) {
    const url = parseUrl(raw);
    if (!url) continue;
    const host = url.hostname.toLowerCase().replace(/^(www|m|web)\./, "");
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    if (path) {
      const id = url.searchParams.get("id");
      return `facebook:${host}${path}${path === "/profile.php" && id ? `?id=${id}` : ""}`;
    }
  }
  return "";
}

export function videoAccountIdentity(item: any): VideoAccountIdentity {
  const provider = providerOf(item);
  const creatorId = String(item?.creatorId || "").trim();
  const profileUrl = String(item?.creatorProfileUrl || "").trim();
  const name = String(item?.creatorName || "").trim();

  const strong =
    provider === "youtube"
      ? youtubeStrongKey(creatorId, profileUrl)
      : provider === "tiktok"
        ? tiktokStrongKey(creatorId, profileUrl)
        : provider === "facebook"
          ? facebookStrongKey(creatorId, profileUrl)
          : "";
  if (strong) return { key: strong, provider, name, kind: "strong" };

  const normalizedName = normalizeVideoAccountName(name);
  if (normalizedName) return { key: `${provider}:name:${normalizedName}`, provider, name, kind: "name" };
  return { key: "", provider, name, kind: "none" };
}

/**
 * Same account? Equal keys, or the same platform and channel name when one side only has a name
 * (or YouTube channel id vs handle, which describe one channel in two formats).
 */
export function videoAccountsMatch(a: VideoAccountIdentity, b: VideoAccountIdentity): boolean {
  if (!a.key || !b.key) return false;
  if (a.key === b.key) return true;
  if (a.provider !== b.provider) return false;
  const nameA = normalizeVideoAccountName(a.name);
  const nameB = normalizeVideoAccountName(b.name);
  if (!nameA || nameA !== nameB) return false;
  if (a.kind === "name" || b.kind === "name") return true;
  const youtubeFormats = (key: string) => (key.startsWith("youtube:channel:") ? "channel" : "handle");
  return a.provider === "youtube" && youtubeFormats(a.key) !== youtubeFormats(b.key);
}
