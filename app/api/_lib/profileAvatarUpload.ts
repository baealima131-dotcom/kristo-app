import fs from "node:fs/promises";
import path from "node:path";
import {
  getProfile,
  upsertProfilePersist,
  type UserProfile,
} from "@/app/api/auth/_lib/profile";
import {
  getVideoStorageConfig,
  uploadBufferToStorage,
} from "@/app/api/_lib/media/objectStorage";

const MAX_AVATAR_DATA_URL_LEN = 2_800_000;

export function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function isProfileAvatarDataUrl(raw: unknown): boolean {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .startsWith("data:image");
}

export function isPersistedProfileAvatarUrl(raw: unknown): boolean {
  const trimmed = String(raw || "").trim();
  if (!trimmed || isProfileAvatarDataUrl(trimmed)) return false;
  if (trimmed.startsWith("file://")) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith("/uploads/") || /^uploads\//i.test(trimmed)) return true;
  return false;
}

function parseDataImageUrl(raw: string): { ext: string; contentType: string; buffer: Buffer } | null {
  const match = raw.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;

  const ext = match[1].toLowerCase().replace("jpeg", "jpg");
  const contentType =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  return {
    ext,
    contentType,
    buffer: Buffer.from(match[2], "base64"),
  };
}

/** Upload profile avatar bytes — returns only durable http(s) or /uploads paths, never data URLs. */
export async function uploadProfileAvatarFromDataUrl(
  userId: string,
  avatarData: string
): Promise<string> {
  const raw = String(avatarData || "").trim();
  if (!raw.startsWith("data:image/")) return "";
  if (raw.length > MAX_AVATAR_DATA_URL_LEN) {
    throw new Error("Avatar image is too large. Choose a smaller photo (max ~2MB).");
  }

  const parsed = parseDataImageUrl(raw);
  if (!parsed) return "";

  const safeUserId = String(userId || "user").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeUserId}-${Date.now()}.${parsed.ext}`;

  const storageConfig = getVideoStorageConfig();
  if (storageConfig) {
    const key = `uploads/profile-avatars/${filename}`;
    const { publicUrl } = await uploadBufferToStorage({
      key,
      body: parsed.buffer,
      contentType: parsed.contentType,
    });
    return publicUrl;
  }

  if (isServerlessRuntime()) {
    console.log("KRISTO_PROFILE_AVATAR_DATA_URL_NEEDS_UPLOAD", {
      userId,
      reason: "serverless-no-object-storage",
      byteLen: raw.length,
    });
    return "";
  }

  const dir = path.join(process.cwd(), "public", "uploads", "profile-avatars");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), parsed.buffer);
  return `/uploads/profile-avatars/${filename}`;
}

/** Profile POST: upload when possible; fall back to inline data URL only for legacy profile display. */
export async function saveProfileAvatarForProfilePost(
  userId: string,
  avatarData: string
): Promise<string> {
  const uploaded = await uploadProfileAvatarFromDataUrl(userId, avatarData);
  if (uploaded) return uploaded;

  const raw = String(avatarData || "").trim();
  if (!raw.startsWith("data:image/")) return "";
  if (isServerlessRuntime() && raw.length <= MAX_AVATAR_DATA_URL_LEN) {
    return raw;
  }
  return "";
}

export function pickRawProfileAvatar(profile: any): string {
  const candidates = [
    profile?.avatarUrl,
    profile?.avatarUri,
    profile?.profileImage,
    profile?.photoURL,
    profile?.image,
  ];
  for (const raw of candidates) {
    const trimmed = String(raw || "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function pickPersistedProfileAvatarUrl(profile: any): string {
  const candidates = [
    profile?.avatarUrl,
    profile?.avatarUri,
    profile?.profileImage,
    profile?.photoURL,
    profile?.image,
  ];
  for (const raw of candidates) {
    if (isPersistedProfileAvatarUrl(raw)) return String(raw).trim();
  }
  return "";
}

export async function ensureProfileAvatarUrlForClaim(userId: string): Promise<string> {
  const uid = String(userId || "").trim();
  if (!uid) return "";

  let profile: UserProfile | null = null;
  try {
    profile = (await getProfile(uid)) || null;
  } catch {
    profile = null;
  }

  if (!profile) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId: uid,
      reason: "no-profile",
    });
    return "";
  }

  const persisted = pickPersistedProfileAvatarUrl(profile);
  if (persisted) {
    console.log("KRISTO_PROFILE_AVATAR_URL_RESOLVED_FOR_CLAIM", {
      userId: uid,
      source: "profile-persisted",
      avatarUrl: persisted.slice(0, 160),
    });
    return persisted;
  }

  const raw = pickRawProfileAvatar(profile);
  if (!raw) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId: uid,
      reason: "no-avatar-field",
    });
    return "";
  }

  if (!isProfileAvatarDataUrl(raw)) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId: uid,
      reason: "unsupported-uri-scheme",
      preview: raw.slice(0, 80),
    });
    return "";
  }

  console.log("KRISTO_PROFILE_AVATAR_DATA_URL_NEEDS_UPLOAD", {
    userId: uid,
    byteLen: raw.length,
    stage: "claim-migration",
  });

  try {
    const uploaded = await uploadProfileAvatarFromDataUrl(uid, raw);
    if (!uploaded) {
      console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
        userId: uid,
        reason: "upload-failed",
      });
      return "";
    }

    const next = {
      ...profile,
      avatarUrl: uploaded,
      updatedAt: Date.now(),
    };
    await upsertProfilePersist(next);

    console.log("KRISTO_PROFILE_AVATAR_URL_RESOLVED_FOR_CLAIM", {
      userId: uid,
      source: "migrated-from-data-url",
      avatarUrl: uploaded.slice(0, 160),
    });
    return uploaded;
  } catch (error) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId: uid,
      reason: "upload-error",
      error: String((error as any)?.message || error),
    });
    return "";
  }
}
