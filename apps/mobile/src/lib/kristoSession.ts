import AsyncStorage from "@react-native-async-storage/async-storage";

export type KristoRole = "Pastor" | "Member" | "Church_Admin" | "System_Admin" | "Leader" | "Ministry_Leader";

export type KristoSession = {
  userId: string;
  role: KristoRole;
  churchId: string; // empty => not joined
};

const KEY = "kristo.session.v1";

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

    if (!userId) return null;
    const s: KristoSession = { userId, role, churchId };
    setSessionSync(s);
    return s;
  } catch {
    return null;
  }
}

export async function saveSession(s: KristoSession): Promise<void> {
  setSessionSync(s);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export async function clearSession(): Promise<void> {
  setSessionSync(null);
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

// helper ids
export function makeChurchId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
