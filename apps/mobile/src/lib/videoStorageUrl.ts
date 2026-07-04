const VIDEO_PUBLIC_BASE = String(
  process.env.EXPO_PUBLIC_VIDEO_STORAGE_PUBLIC_BASE_URL || "https://videos.kristoapp.com"
).replace(/\/+$/, "");

const PUBLIC_VIDEO_KEY_PREFIXES = [
  "church-videos/",
  "church-video-posters/",
  "church-video-previews/",
];

function decodeKeyPath(rawKey: string): string {
  try {
    return rawKey
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return rawKey;
  }
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isPublicVideoStorageKey(key: string) {
  return PUBLIC_VIDEO_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Rewrite legacy `*.r2.dev` playback URLs to the configured custom delivery domain. */
export function canonicalPublicVideoPlaybackUrl(rawUrl: string): string {
  const raw = String(rawUrl || "").trim();
  if (!raw || !VIDEO_PUBLIC_BASE || !/^https?:\/\//i.test(raw)) return raw;

  try {
    const [pathPart, ...queryParts] = raw.split("?");
    const parsed = new URL(pathPart);
    if (!parsed.hostname.endsWith(".r2.dev")) return raw;

    const rawKey = parsed.pathname.replace(/^\/+/, "");
    if (!rawKey || !isPublicVideoStorageKey(rawKey)) return raw;

    const key = decodeKeyPath(rawKey);
    const canonical = `${VIDEO_PUBLIC_BASE}/${encodeKeyPath(key)}`;
    return queryParts.length ? `${canonical}?${queryParts.join("?")}` : canonical;
  } catch {
    return raw;
  }
}
