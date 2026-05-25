import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChurchDraft } from "./churchStore";
import { getKristoHeaders } from "./kristoHeaders";

export type ChurchDirectoryItem = ChurchDraft & {
  churchProvince?: string;
  pastorName?: string;
};

const KEY = "kristo_church_directory_v1";

function cleanId(v: string) {
  return String(v || "").trim().replace(/\s+/g, "").toUpperCase();
}

function getBase() {
  return String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

export type PublishChurchResult =
  | { ok: true; remote: boolean; membershipCreated?: boolean }
  | { ok: false; error: string; remote: boolean };

export async function loadChurchDirectory(): Promise<ChurchDirectoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function upsertChurchDirectory(item: ChurchDirectoryItem): Promise<void> {
  const list = await loadChurchDirectory();
  const id = cleanId(item.churchId);
  const next = [item, ...list.filter((x) => cleanId(x.churchId) !== id)];
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function publishChurchDirectory(item: ChurchDirectoryItem): Promise<PublishChurchResult> {
  await upsertChurchDirectory(item);

  const base = getBase();
  if (!base) return { ok: true, remote: false };

  const pastorId = String((item as any).userId || (item as any).createdBy || "").trim();
  const pastorName = String((item as any).pastorName || item.churchProfile?.name || "Pastor").trim();
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    ...getKristoHeaders({
      userId: pastorId,
      role: "Pastor",
      churchId: String(item.churchId || ""),
    }),
  };

  try {
    const r = await fetch(`${base}/api/church/directory`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        churchId: item.churchId,
        name: item.churchName || item.churchProfile?.name || item.churchId,
        phone: item.churchPhone || item.churchProfile?.phone,
        country: item.churchCountry || item.churchProfile?.country,
        province: item.churchProvince || item.churchProfile?.province,
        city: item.churchCity || item.churchProfile?.city,
        pastorId,
        pastorName,
      }),
    });

    const j = await r.json().catch(() => ({} as any));
    if (!r.ok || !j?.ok) {
      const err = String(j?.error || `Server rejected church (${r.status})`);
      if (__DEV__) {
        console.warn("[publishChurchDirectory] failed", { status: r.status, err, pastorId, churchId: item.churchId });
      }
      return { ok: false, error: err, remote: true };
    }

    if (__DEV__) {
      console.log("[publishChurchDirectory] ok", {
        churchId: item.churchId,
        pastorId,
        membershipCreated: Boolean(pastorId),
      });
    }

    return { ok: true, remote: true, membershipCreated: Boolean(pastorId) };
  } catch (e: any) {
    const err = String(e?.message || e || "Network error");
    if (__DEV__) console.warn("[publishChurchDirectory] network error", err);
    return { ok: false, error: err, remote: true };
  }
}

export async function findChurchById(churchId: string): Promise<ChurchDirectoryItem | null> {
  const id = cleanId(churchId);
  if (!id) return null;

  const base = getBase();
  if (base) {
    try {
      const r = await fetch(`${base}/api/church/directory?id=${encodeURIComponent(id)}`);
      const j = await r.json().catch(() => ({} as any));
      if (r.ok && j?.ok && j?.data?.id) {
        return {
          churchId: String(j.data.id),
          churchName: String(j.data.name || j.data.id),
          churchPhone: String(j.data.phone || ""),
          churchCountry: String(j.data.country || ""),
          churchProvince: String(j.data.province || ""),
          churchCity: String(j.data.city || ""),
          churchProfile: {
            name: String(j.data.name || j.data.id),
            phone: String(j.data.phone || ""),
            country: String(j.data.country || ""),
            province: String(j.data.province || ""),
            city: String(j.data.city || j.data.address || ""),
          },
        };
      }
    } catch {}
  }

  const list = await loadChurchDirectory();
  return list.find((x) => cleanId(x.churchId) === id) || null;
}
