import AsyncStorage from "@react-native-async-storage/async-storage";

import type { KristoMediaProfile } from "@/src/lib/kristoSession";

export type ChurchMediaProfileCache = KristoMediaProfile & {
  id?: string;
  churchId: string;
  ownerUserId?: string;
  updatedAt?: number;
};

const KEY_PREFIX = "kristo_church_media_profile_v1:";

function cacheKey(churchId: string) {
  return `${KEY_PREFIX}${String(churchId || "").trim().toUpperCase()}`;
}

export async function loadChurchMediaProfileCache(
  churchId?: string | null
): Promise<ChurchMediaProfileCache | null> {
  const id = String(churchId || "").trim();
  if (!id) return null;

  try {
    const raw = await AsyncStorage.getItem(cacheKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChurchMediaProfileCache;
    if (String(parsed?.churchId || "").trim().toUpperCase() !== id.toUpperCase()) return null;
    if (!String(parsed?.mediaName || "").trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveChurchMediaProfileCache(profile: ChurchMediaProfileCache): Promise<void> {
  const churchId = String(profile?.churchId || "").trim();
  if (!churchId || !String(profile?.mediaName || "").trim()) return;

  const next: ChurchMediaProfileCache = {
    ...profile,
    churchId,
    updatedAt: Date.now(),
  };

  await AsyncStorage.setItem(cacheKey(churchId), JSON.stringify(next));
}

export async function clearChurchMediaProfileCache(churchId?: string | null): Promise<void> {
  const id = String(churchId || "").trim();
  if (!id) return;
  await AsyncStorage.removeItem(cacheKey(id));
}
