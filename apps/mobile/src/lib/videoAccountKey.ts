/**
 * Identity of the YouTube / TikTok / Facebook account behind a System Admin video-link post.
 * Used by the Home Feed / Watch author row to open the in-app Video Account Overview.
 *
 * KEEP IN SYNC with app/api/_lib/videoAccountKey.ts (scripts/videoAccountOverview.test.ts checks
 * both give the same keys).
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

/** Display label of the platform chip. */
export function videoAccountPlatformLabel(provider: string): string {
  if (provider === "youtube") return "YouTube";
  if (provider === "tiktok") return "TikTok";
  if (provider === "facebook") return "Facebook";
  return "Video";
}
