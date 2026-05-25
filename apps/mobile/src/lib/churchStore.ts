import AsyncStorage from "@react-native-async-storage/async-storage";

export type ChurchDraft = {
  churchId: string;
  role?: string;
  churchProfile?: any;
  churchName?: string;
  churchPhone?: string;
  churchCountry?: string;
  churchCity?: string;
};

const KEY = "kristo_church_v1";

function keyForUser(userId?: string | null) {
  const id = String(userId || "").trim();
  return id ? `${KEY}:${id}` : KEY;
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
