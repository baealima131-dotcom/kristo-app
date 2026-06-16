import { resolveApiBase } from "@/src/lib/kristoEnv";

type MemberDirectoryEntry = {
  name: string;
  avatarUri: string;
  churchRole?: string;
  isMediaHost?: boolean;
};

const memberDirectory = new Map<string, MemberDirectoryEntry>();

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function toMediaStorageUrl(raw: unknown) {
  try {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (/^(https?:|file:|data:image\/)/i.test(v)) return v;
    const base = String(resolveApiBase() || "")
      .trim()
      .replace(/\/+$/, "");
    if (!base) return v;
    return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
  } catch {
    return "";
  }
}

function looksLikeUserId(value: string) {
  const v = value.trim();
  if (!v) return true;
  if (/^u[_-]?[a-f0-9]{6,}$/i.test(v)) return true;
  if (v.length >= 18 && !v.includes(" ") && /^[a-z0-9_-]+$/i.test(v)) return true;
  return false;
}

function sanitizeDisplayName(value: unknown, userId = "") {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (raw.toLowerCase() === "church member") return "";
  if (looksLikeUserId(raw) || (userId && raw === userId)) return "";
  return raw;
}

function roleFromItem(item: any, directory?: MemberDirectoryEntry) {
  const label = sanitizeDisplayName(item?.postedByLabel);
  if (label === "Pastor" || label === "Host") return label;

  const postedByRole = normalizeText(item?.postedByRole || item?.authorRole);
  const lower = postedByRole.toLowerCase();
  if (lower.includes("pastor") || lower.includes("admin")) return "Pastor";
  if (lower.includes("host") || lower.includes("media")) return "Host";

  const churchRole = normalizeText(directory?.churchRole || item?.churchRole);
  const churchLower = churchRole.toLowerCase();
  if (churchLower === "pastor" || churchLower === "church_admin") return "Pastor";
  if (directory?.isMediaHost) return "Host";

  return "";
}

function fallbackNameForRole(role: string) {
  if (role === "Pastor") return "Unknown pastor";
  if (role === "Host") return "Unknown host";
  return "Unknown member";
}

export function indexMediaStorageAuthorDirectory(members: any[] = [], hosts: any[] = []) {
  memberDirectory.clear();

  for (const member of members) {
    const userId = normalizeText(member?.userId || member?.id);
    if (!userId) continue;
    const name = sanitizeDisplayName(
      member?.name || member?.fullName || member?.displayName,
      userId
    );
    memberDirectory.set(userId, {
      name,
      avatarUri: toMediaStorageUrl(
        member?.avatarUri || member?.avatarUrl || member?.profileImage
      ),
      churchRole: normalizeText(member?.churchRole || member?.roleLabel || member?.role),
    });
  }

  for (const host of hosts) {
    const userId = normalizeText(host?.userId || host?.id);
    if (!userId) continue;
    const existing = memberDirectory.get(userId);
    const hostName = sanitizeDisplayName(host?.name || host?.displayName, userId);
    memberDirectory.set(userId, {
      name: hostName || existing?.name || "",
      avatarUri: toMediaStorageUrl(host?.avatarUri || host?.avatarUrl || existing?.avatarUri),
      churchRole: existing?.churchRole,
      isMediaHost: true,
    });
  }
}

export function resolveMediaStorageAuthor(item: any) {
  try {
    const createdBy = normalizeText(
      item?.postedByUserId || item?.createdBy || item?.authorId || item?.userId
    );
    const directory = createdBy ? memberDirectory.get(createdBy) : undefined;
    const role = roleFromItem(item, directory);

    const nameCandidates = [
      item?.postedByName,
      item?.authorName,
      item?.createdByName,
      item?.actorLabel,
      directory?.name,
    ];

    let finalName = "";
    for (const candidate of nameCandidates) {
      const clean = sanitizeDisplayName(candidate, createdBy);
      if (clean) {
        finalName = clean;
        break;
      }
    }

    if (!finalName) {
      finalName = fallbackNameForRole(role);
    }

    const avatarCandidates = [
      item?.postedByAvatarUri,
      item?.authorAvatarUri,
      item?.createdByAvatarUri,
      item?.actorAvatarUri,
      directory?.avatarUri,
    ];

    let avatarUri = "";
    for (const candidate of avatarCandidates) {
      const clean = toMediaStorageUrl(candidate);
      if (clean) {
        avatarUri = clean;
        break;
      }
    }

    if (__DEV__) {
      console.log("KRISTO_MEDIA_STORAGE_AUTHOR_RESOLVE", {
        feedId: normalizeText(item?.id),
        createdBy,
        authorName: normalizeText(item?.authorName),
        postedByName: normalizeText(item?.postedByName),
        createdByName: normalizeText(item?.createdByName),
        directoryName: directory?.name || null,
        finalName,
        finalRole: role || null,
        hasAvatar: Boolean(avatarUri),
      });
    }

    return {
      id: createdBy,
      name: finalName,
      avatarUri,
      role,
      roleLabel: role,
    };
  } catch (error) {
    console.log("KRISTO_MEDIA_STORAGE_AUTHOR_RESOLVE_ERROR", {
      feedId: normalizeText(item?.id),
      message: String((error as any)?.message || error || "unknown"),
    });
    return {
      id: "",
      name: "Unknown member",
      avatarUri: "",
      role: "",
      roleLabel: "",
    };
  }
}
