import type { NextRequest } from "next/server";

import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

export const RAW_USER_ID_RX = /^u_[a-f0-9]{8,}$/i;

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

function pickProfileName(profile: any, user: any): string {
  return String(
    profile?.fullName ||
      profile?.displayName ||
      profile?.name ||
      user?.displayName ||
      user?.name ||
      ""
  ).trim();
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

  const candidates = [
    String(viewer.name || "").trim(),
    headerDisplayName(req),
    identity.name,
  ].filter(Boolean);

  let actorName = "";
  for (const candidate of candidates) {
    if (!isRawUserId(candidate)) {
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

export function sanitizeActorInText(text: string, actorUserId?: string, actorName?: string): string {
  let out = String(text || "");
  const safeName = String(actorName || "").trim();
  const uid = String(actorUserId || "").trim();

  if (uid && safeName && !isRawUserId(safeName)) {
    out = out.split(uid).join(safeName);
  }

  out = out.replace(/\bu_[a-f0-9]{8,}\b/gi, (match) => {
    if (safeName && !isRawUserId(safeName)) return safeName;
    return "Church Admin";
  });

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
