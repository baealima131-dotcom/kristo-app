import AsyncStorage from "@react-native-async-storage/async-storage";

export type ProfileDraft = {
  userId?: string;
  kristoId?: string;
  displayName: string;
  username?: string;
  bio?: string;
  avatarUri?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  gender?: string;
  age?: number;
  updatedAt?: number;
  avatarUpdatedAt?: number;
};

const KEY = "kristo_profile_v1";

function keyForUser(userId?: string | null) {
  const id = String(userId || "").trim();
  return id ? `${KEY}:${id}` : KEY;
}

export async function loadProfileDraft(userId?: string | null): Promise<ProfileDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyForUser(userId));
    if (!raw) return null;
    return JSON.parse(raw) as ProfileDraft;
  } catch {
    return null;
  }
}

export async function saveProfileDraft(d: ProfileDraft, userId?: string | null): Promise<void> {
  const now = Date.now();
  const hasAvatar = Boolean(String(d.avatarUri || "").trim());
  await AsyncStorage.setItem(
    keyForUser(userId),
    JSON.stringify({
      ...d,
      updatedAt: now,
      avatarUpdatedAt: hasAvatar ? d.avatarUpdatedAt || now : d.avatarUpdatedAt,
    })
  );
}

export async function clearProfileDraft(userId?: string | null): Promise<void> {
  await AsyncStorage.removeItem(keyForUser(userId));
}
