import AsyncStorage from "@react-native-async-storage/async-storage";

export type KristoRole = "Pastor" | "Member" | "Church_Admin" | "System_Admin" | "Leader" | "Ministry_Leader";

export type KristoMediaCategory =
  | "Teacher"
  | "Singer"
  | "Counselor"
  | "Preacher"
  | "Motivational Speaker"
  | "Testimony Creator"
  | "Bible Educator"
  | "Church Media";

export type KristoMediaProfile = {
  mediaName: string;
  category: KristoMediaCategory;
  subCategory: string;
  language: string;
  country: string;
  targetAudience: string;
  contentStyle: string;
  bio: string;
  tags: string[];
};

export type KristoSession = {
  userId: string; // backend/internal id
  kristoId?: string; // public Kristo ID shown to user
  role: KristoRole;
  churchId: string; // empty => not joined
  activeChurchId?: string; // synced active membership church id
  name?: string;
  displayName?: string;
  gender?: string;
  phone?: string;
  email?: string;
  avatarUri?: string;
  avatarUrl?: string;
  profileImage?: string;
  address?: string;
  city?: string;
  country?: string;

  churchPhone?: string;
  churchCountry?: string;
  churchProvince?: string;
  churchCity?: string;
  churchPrimaryLanguage?: string;
  churchName?: string;
  churchRole?: KristoRole;

  mediaProfile?: KristoMediaProfile | null;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
};

const KEY = "kristo.session.v1";
export const MOBILE_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days inactivity
export const MOBILE_SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 days hard expiry

// in-memory sync snapshot (for headers)
let _session: KristoSession | null = null;

export function getSessionSync(): KristoSession | null {
  return _session;
}

export function setSessionSync(s: KristoSession | null) {
  _session = s;
}

export async function loadSession(): Promise<KristoSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const userId = String(parsed.userId || "");
    const role = String(parsed.role || "Member") as KristoRole;
    const churchId = String(parsed.churchId || "");
    const mediaProfile =
      parsed.mediaProfile && typeof parsed.mediaProfile === "object"
        ? {
            mediaName: String(parsed.mediaProfile.mediaName || ""),
            category: String(parsed.mediaProfile.category || "Teacher") as KristoMediaCategory,
            subCategory: String(parsed.mediaProfile.subCategory || ""),
            language: String(parsed.mediaProfile.language || ""),
            country: String(parsed.mediaProfile.country || ""),
            targetAudience: String(parsed.mediaProfile.targetAudience || ""),
            contentStyle: String(parsed.mediaProfile.contentStyle || ""),
            bio: String(parsed.mediaProfile.bio || ""),
            tags: Array.isArray(parsed.mediaProfile.tags)
              ? parsed.mediaProfile.tags.map((x: unknown) => String(x || "").trim()).filter(Boolean)
              : [],
          }
        : null;

    if (!userId) return null;

    const now = Date.now();
    const lastSeenAt = Number(parsed.lastSeenAt || parsed.createdAt || now);
    const expiresAt = Number(parsed.expiresAt || (lastSeenAt + MOBILE_SESSION_MAX_MS));

    if (now - lastSeenAt > MOBILE_SESSION_IDLE_MS || now > expiresAt) {
      await clearSession();
      return null;
    }

    const s: KristoSession = {
      userId,
      kristoId: String(parsed.kristoId || parsed.publicKristoId || parsed.secureId || ""),
      role,
      churchId,
      name: String(parsed.name || ""),
      displayName: String(parsed.displayName || parsed.name || ""),
      gender: String(parsed.gender || ""),
      phone: String(parsed.phone || ""),
      email: String(parsed.email || ""),
      avatarUri: String(parsed.avatarUri || parsed.avatarUrl || parsed.profileImage || ""),
      avatarUrl: String(parsed.avatarUrl || parsed.avatarUri || parsed.profileImage || ""),
      profileImage: String(parsed.profileImage || parsed.avatarUrl || parsed.avatarUri || ""),
      address: String(parsed.address || ""),
      city: String(parsed.city || ""),
      country: String(parsed.country || ""),

      churchPhone: String(parsed.churchPhone || ""),
      churchCountry: String(parsed.churchCountry || ""),
      churchProvince: String(parsed.churchProvince || ""),
      churchCity: String(parsed.churchCity || ""),
      churchPrimaryLanguage: String(parsed.churchPrimaryLanguage || parsed.primaryLanguage || ""),
      churchName: String(parsed.churchName || ""),
      churchRole: String(parsed.churchRole || parsed.role || "Member") as KristoRole,

      mediaProfile,
      createdAt: Number(parsed.createdAt || now),
      lastSeenAt,
      expiresAt,
    };
    setSessionSync(s);
    return s;
  } catch {
    return null;
  }
}

export async function saveSession(s: KristoSession): Promise<void> {
  const now = Date.now();
  const next: KristoSession = {
    ...s,
    createdAt: Number(s.createdAt || now),
    lastSeenAt: now,
    expiresAt: Number(s.expiresAt || (now + MOBILE_SESSION_MAX_MS)),
  };

  setSessionSync(next);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export async function touchMobileSession(): Promise<KristoSession | null> {
  const current = _session || (await loadSession());
  if (!current) return null;

  const next: KristoSession = {
    ...current,
    lastSeenAt: Date.now(),
  };

  await saveSession(next);
  return next;
}

export async function clearSession(): Promise<void> {
  setSessionSync(null);
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

// helper ids
export function makeChurchId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CH7-${rand}`;
}


export function makeUserId() {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  const digits = String(Date.now()).slice(-5);
  return `KR7-${digits}${n.slice(-1)}${r.slice(0, 1)}`;
}
