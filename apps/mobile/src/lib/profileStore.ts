import AsyncStorage from "@react-native-async-storage/async-storage";

export type ProfileDraft = {
  displayName: string;
  username?: string;
  bio?: string;
  avatarUri?: string;
};

const KEY = "kristo_profile_v1";

export async function loadProfileDraft(): Promise<ProfileDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProfileDraft;
  } catch {
    return null;
  }
}

export async function saveProfileDraft(d: ProfileDraft): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(d));
}

export async function clearProfileDraft(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
