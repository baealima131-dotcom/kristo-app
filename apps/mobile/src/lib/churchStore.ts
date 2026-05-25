import AsyncStorage from "@react-native-async-storage/async-storage";

export type ChurchDraft = {
  churchId: string;
  role?: string;
  churchProfile?: any;
  churchName?: string;
  churchPhone?: string;
  churchCountry?: string;
  churchCity?: string;
  pastorName?: string;
  address?: string;
  avatarUri?: string;
  avatarUrl?: string;
};

export type ChurchProfileCache = {
  churchId: string;
  name?: string;
  pastorName?: string;
  phone?: string;
  address?: string;
  avatarUri?: string;
  avatarUrl?: string;
  updatedAt?: number;
};

const KEY = "kristo_church_v1";
const PROFILE_CACHE_PREFIX = "kristo_church_profile_v1:";

function keyForUser(userId?: string | null) {
  const id = String(userId || "").trim();
  return id ? `${KEY}:${id}` : KEY;
}

function profileCacheKey(churchId: string) {
  return `${PROFILE_CACHE_PREFIX}${String(churchId || "").trim().toUpperCase()}`;
}

export async function loadChurchDraft(userId?: string | null): Promise<ChurchDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyForUser(userId));
    if (!raw) return null;
    return JSON.parse(raw) as ChurchDraft;
  } catch {
    return null;
  }
}

export async function saveChurchDraft(d: ChurchDraft, userId?: string | null): Promise<void> {
  await AsyncStorage.setItem(keyForUser(userId), JSON.stringify(d));
}

export async function clearChurchDraft(userId?: string | null): Promise<void> {
  await AsyncStorage.removeItem(keyForUser(userId));
}

export async function loadChurchProfileCache(churchId?: string | null): Promise<ChurchProfileCache | null> {
  const id = String(churchId || "").trim();
  if (!id) return null;
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as ChurchProfileCache;
  } catch {
    return null;
  }
}

export async function saveChurchProfileCache(profile: ChurchProfileCache): Promise<void> {
  const churchId = String(profile.churchId || "").trim();
  if (!churchId) return;
  const next: ChurchProfileCache = {
    ...profile,
    churchId,
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(profileCacheKey(churchId), JSON.stringify(next));
}

export async function resolveChurchDisplayName(
  churchId: string,
  userId?: string | null
): Promise<string> {
  const id = String(churchId || "").trim();
  if (!id) return "";

  const cached = await loadChurchProfileCache(id);
  if (cached?.name) return String(cached.name).trim();

  const draft = await loadChurchDraft(userId);
  if (draft && String(draft.churchId || "").trim() === id) {
    const fromDraft = String(draft.churchName || draft.churchProfile?.name || "").trim();
    if (fromDraft) return fromDraft;
  }

  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (base) {
    try {
      const r = await fetch(`${base}/api/church/directory?id=${encodeURIComponent(id)}`);
      const j = await r.json().catch(() => ({} as any));
      const name = String(j?.data?.name || "").trim();
      if (r.ok && j?.ok && name) {
        await saveChurchProfileCache({ churchId: id, name });
        return name;
      }
    } catch {}
  }

  return id;
}
