import type { NextRequest } from "next/server";

import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

export const RAW_USER_ID_RX = /^u_[a-f0-9]{8,}$/i;

/** Matches local@domain.tld style addresses (privacy: never show as actor names). */
export const EMAIL_LIKE_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Matches an email substring anywhere in notification title/body/preview text. */
export const EMAIL_IN_TEXT_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function isRawUserId(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return false;
  return RAW_USER_ID_RX.test(s);
}

export function isEmailLike(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return false;
  return EMAIL_LIKE_RX.test(s);
}

export function isUnsafeActorDisplayName(value?: string | null): boolean {
  const s = String(value || "").trim();
  if (!s) return true;
  return isRawUserId(s) || isEmailLike(s);
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

function firstSafePublicName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value && !isUnsafeActorDisplayName(value)) return value;
  }
  return "";
}

function pickProfileName(profile: any, user: any): string {
  // Public-name preference: display name → Kristo ID → (caller applies role/neutral).
  return firstSafePublicName(
    profile?.displayName,
    profile?.fullName,
    profile?.name,
    user?.displayName,
    user?.fullName,
    user?.name,
    profile?.kristoId,
    user?.kristoId,
    profile?.username,
    user?.username
  );
}

function pickProfileAvatar(profile: any, user: any): string {
  return String(
    profile?.avatarUrl ||
      profile?.avatarUri ||
      profile?.profileImage ||
      profile?.photoURL ||
      profile?.image ||
      user?.avatarUrl ||
      user?.avatarUri ||
      user?.profileImage ||
      user?.photoURL ||
      ""
  ).trim();
}

export type ActorIdentity = {
  actorUserId: string;
  actorName: string;
  actorAvatarUri: string;
  actorRole: string;
};

export async function resolveActorIdentity(userId: string): Promise<{ name: string; avatar: string }> {
  const raw = String(userId || "").trim();
  if (!raw) return { name: "", avatar: "" };

  let profile: any = (await getProfile(raw)) || null;
  if (!profile && raw !== raw.toLowerCase()) {
    profile = (await getProfile(raw.toLowerCase())) || null;
  }

  const resolvedUserId = String(profile?.userId || raw).trim();
  const user: any = resolvedUserId ? await getUserById(resolvedUserId) : null;

  if (!profile && user) {
    profile = (await getProfile(resolvedUserId)) || null;
  }

  const name = pickProfileName(profile, user);
  const avatar = pickProfileAvatar(profile, user);

  return { name, avatar };
}

function headerDisplayName(req?: NextRequest): string {
  if (!req) return "";
  return String(
    req.headers.get("x-kristo-user-name") ||
      req.headers.get("x-kristo-display-name") ||
      req.headers.get("x-kristo-name") ||
      ""
  ).trim();
}

export async function resolveActorFromViewer(
  viewer: { userId: string; name?: string; role?: string },
  req?: NextRequest
): Promise<ActorIdentity> {
  const actorUserId = String(viewer.userId || "").trim();
  const actorRole = String(viewer.role || "Member").trim();
  const identity = actorUserId ? await resolveActorIdentity(actorUserId) : { name: "", avatar: "" };

  // Prefer public display name from profile, then Kristo ID / other safe labels,
  // then request headers / viewer seed (never email). Role is the final fallback.
  const candidates = [
    identity.name,
    headerDisplayName(req),
    String(viewer.name || "").trim(),
  ].filter(Boolean);

  let actorName = "";
  for (const candidate of candidates) {
    if (!isUnsafeActorDisplayName(candidate)) {
      actorName = candidate;
      break;
    }
  }

  if (!actorName) {
    actorName = roleFallbackLabel(actorRole);
  }

  return {
    actorUserId,
    actorName,
    actorAvatarUri: identity.avatar,
    actorRole,
  };
}

export function redactEmailsInText(text: string, replacement = "Member"): string {
  const safe = String(replacement || "").trim() || "Member";
  const redacted = isEmailLike(safe) ? "Member" : safe;
  return String(text || "")
    .replace(EMAIL_IN_TEXT_RX, redacted)
    .trim();
}

export function sanitizeActorInText(text: string, actorUserId?: string, actorName?: string): string {
  let out = String(text || "");
  const safeName = String(actorName || "").trim();
  const uid = String(actorUserId || "").trim();
  const replacement =
    safeName && !isUnsafeActorDisplayName(safeName) ? safeName : "Church Admin";

  if (uid && replacement) {
    out = out.split(uid).join(replacement);
  }

  out = out.replace(/\bu_[a-f0-9]{8,}\b/gi, replacement);
  out = redactEmailsInText(out, replacement);

  return out.trim();
}

export function extractLeadingActorUserId(text: string): string {
  const body = String(text || "").trim();
  const match = body.match(/^(\S+)\s+(updated|added|removed|changed|created|replied|commented|requested|liked)\b/i);
  if (match?.[1] && isRawUserId(match[1])) return match[1];
  return "";
}

export function initialsFromDisplayName(name?: string | null): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "N";
  return parts.map((x) => x[0]?.toUpperCase() || "").join("");
}
