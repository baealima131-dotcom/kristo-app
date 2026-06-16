export type NotificationLike = {
  title?: string;
  body?: string;
  message?: string;
  text?: string;
  actorName?: string;
  actorUserId?: string;
  actorAvatarUri?: string;
  actorRole?: string;
  avatarUri?: string;
  avatarUrl?: string;
  profileImage?: string;
  type?: string;
};

const RAW_USER_ID_RX = /^u_[a-f0-9]{8,}$/i;

export function isRawUserId(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return false;
  return RAW_USER_ID_RX.test(s);
}

export function roleFallbackLabel(role?: string | null): string {
  const r = String(role || "").trim();
  if (r === "Pastor") return "Pastor";
  if (r === "Church_Admin") return "Church Admin";
  if (r === "System_Admin") return "System Admin";
  if (r === "Ministry_Leader") return "Ministry Leader";
  if (r === "Leader") return "Leader";
  if (r === "Member") return "Member";
  return "Church Admin";
}

function extractActorNameFromBody(body: string): string {
  const text = String(body || "").trim();
  if (!text) return "";

  const patterns = [
    /^(.+?)\s+replied\b/i,
    /^(.+?)\s+commented\b/i,
    /^(.+?)\s+requested\b/i,
    /^(.+?)\s+updated\b/i,
    /^(.+?)\s+added\b/i,
    /^(.+?)\s+removed\b/i,
    /^(.+?)\s+changed\b/i,
    /^(.+?)\s+liked\b/i,
    /^([^:]+):/,
  ];

  for (const rx of patterns) {
    const m = text.match(rx);
    const candidate = String(m?.[1] || "").trim();
    if (candidate && !isRawUserId(candidate)) return candidate;
  }

  return "";
}

function sanitizeUserIdsInText(text: string, replacement = "Church Admin"): string {
  let out = String(text || "");
  out = out.replace(/\bu_[a-f0-9]{8,}\b/gi, replacement);
  return out.trim();
}

export function safeDisplayName(notification: NotificationLike): string {
  const actorName = String(notification?.actorName || "").trim();
  if (actorName && !isRawUserId(actorName)) return actorName;

  const body = String(notification?.body || notification?.message || notification?.text || "");
  const fromBody = extractActorNameFromBody(body);
  if (fromBody) return fromBody;

  if (notification?.type === "ChurchProfileUpdated") {
    return roleFallbackLabel(notification?.actorRole || "Church_Admin");
  }

  return roleFallbackLabel(notification?.actorRole);
}

export function safeBody(notification: NotificationLike): string {
  const raw = String(notification?.body || notification?.message || notification?.text || "");
  const displayName = safeDisplayName(notification);
  const replacement = isRawUserId(displayName) ? roleFallbackLabel(notification?.actorRole) : displayName;
  return sanitizeUserIdsInText(raw, replacement || "Church Admin");
}

function toAbsoluteAvatarUri(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("file://") || v.startsWith("data:image/")) return v;
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (!base) return v;
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

export function safeAvatarUri(notification: NotificationLike): string {
  const candidates = [
    notification?.actorAvatarUri,
    notification?.avatarUri,
    notification?.avatarUrl,
    notification?.profileImage,
  ];

  for (const raw of candidates) {
    const uri = toAbsoluteAvatarUri(String(raw || "").trim());
    if (uri) return uri;
  }

  return "";
}

export function safeInitial(notification: NotificationLike): string {
  const name = safeDisplayName(notification);
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "N";
  return parts.map((x) => x[0]?.toUpperCase() || "").join("");
}
