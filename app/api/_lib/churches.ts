import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { hasDurableStore } from "@/app/api/_lib/store/authDb";
import {
  dbGetChurchById,
  dbListChurches,
  dbUpsertChurch,
  ensureChurchStoreReady,
} from "@/app/api/_lib/store/churchDb";

export type ChurchProfile = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  country?: string;
  province?: string;
  city?: string;
  phoneCountryCode?: string;
  normalizedCountry?: string;
  normalizedProvince?: string;
  normalizedCity?: string;
  primaryLanguage?: string;
  pastorName?: string;
  avatarUri?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt?: string;
};

const STORE_FILE = "churches.json";

function usePostgres() {
  return hasDurableStore();
}

async function ensureStore() {
  if (usePostgres()) await ensureChurchStoreReady();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeGeo(input: unknown): string | undefined {
  const s = clean(input, 120);
  if (!s) return undefined;
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function phoneCountryCode(input: unknown): string | undefined {
  const m = String(input || "").trim().match(/^\+(\d{1,4})/);
  return m ? `+${m[1]}` : undefined;
}

function languageHint(country?: unknown): string | undefined {
  const c = String(country || "").toLowerCase();
  if (c.includes("burundi")) return "rn";
  if (c.includes("tanzania") || c.includes("kenya") || c.includes("congo")) return "sw";
  if (c.includes("france") || c.includes("congo")) return "fr";
  if (c.includes("united states") || c.includes("usa")) return "en";
  return undefined;
}

function avatarField(input: unknown, prev?: string) {
  const s = String(input ?? "").trim();
  if (!s) return prev;
  if (s.startsWith("data:image/")) return s;
  return clean(s, 4000) ?? prev;
}

function clean(input: unknown, max = 120): string | undefined {
  if (input === undefined || input === null) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

async function readAll(): Promise<ChurchProfile[]> {
  if (usePostgres()) {
    await ensureStore();
    return dbListChurches();
  }
  const data = await readJsonFile<ChurchProfile[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

export async function getChurchById(churchId: string): Promise<ChurchProfile | undefined> {
  if (usePostgres()) {
    await ensureStore();
    const row = await dbGetChurchById(churchId);
    return row || undefined;
  }
  const all = await readAll();
  return all.find((c) => c.id === churchId);
}

export type ChurchSearchHit = ChurchProfile & {
  score: number;
  verified: boolean;
  distanceKm: number | null;
  countryCode?: string;
};

function normalizeSearch(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const COUNTRY_ISO: Record<string, string> = {
  angola: "AO",
  argentina: "AR",
  australia: "AU",
  belgium: "BE",
  benin: "BJ",
  botswana: "BW",
  brazil: "BR",
  burundi: "BI",
  cameroon: "CM",
  canada: "CA",
  chad: "TD",
  chile: "CL",
  china: "CN",
  colombia: "CO",
  congo: "CG",
  drcongo: "CD",
  drc: "CD",
  egypt: "EG",
  ethiopia: "ET",
  france: "FR",
  gabon: "GA",
  gambia: "GM",
  germany: "DE",
  ghana: "GH",
  guinea: "GN",
  india: "IN",
  indonesia: "ID",
  italy: "IT",
  japan: "JP",
  kenya: "KE",
  lesotho: "LS",
  liberia: "LR",
  madagascar: "MG",
  malawi: "MW",
  mali: "ML",
  mexico: "MX",
  mozambique: "MZ",
  namibia: "NA",
  netherlands: "NL",
  nigeria: "NG",
  rwanda: "RW",
  senegal: "SN",
  southafrica: "ZA",
  southsudan: "SS",
  spain: "ES",
  sudan: "SD",
  tanzania: "TZ",
  uganda: "UG",
  unitedkingdom: "GB",
  unitedstates: "US",
  usa: "US",
  zambia: "ZM",
  zimbabwe: "ZW",
};

function countryCodeFor(church: ChurchProfile): string | undefined {
  const key =
    String((church as any).normalizedCountry || "").trim() ||
    normalizeGeo(church.country) ||
    "";
  if (key && COUNTRY_ISO[key]) return COUNTRY_ISO[key];

  const phone = String((church as any).phoneCountryCode || church.phone || "");
  if (phone.startsWith("+257")) return "BI";
  if (phone.startsWith("+254")) return "KE";
  if (phone.startsWith("+255")) return "TZ";
  if (phone.startsWith("+243") || phone.startsWith("+242")) return "CD";
  if (phone.startsWith("+1")) return "US";
  return undefined;
}

function isHiddenFromSearch(id: string) {
  const x = String(id || "").trim();
  if (!x) return true;
  const lower = x.toLowerCase();
  if (lower === "church_dev_default") return true;
  if (/^c-demo-/i.test(x)) return true;
  if (/^c\d+$/i.test(x)) return true;
  if (/^c_[a-z0-9_]+$/i.test(x)) return true;
  return !/^CH7-[A-Z0-9]{4,12}$/i.test(x);
}

function isVerifiedChurch(church: ChurchProfile) {
  const hasPastor = Boolean(String(church.pastorName || "").trim());
  const hasLocation = Boolean(String(church.city || church.country || church.address || "").trim());
  const hasPhone = Boolean(String(church.phone || "").trim());
  return hasPastor || (hasLocation && hasPhone);
}

function textHaystack(church: ChurchProfile) {
  return [
    church.id,
    church.name,
    church.address,
    church.city,
    church.province,
    church.country,
    church.pastorName,
  ]
    .map((x) => normalizeSearch(x))
    .join(" ");
}

function scoreChurch(
  church: ChurchProfile,
  params: {
    q: string;
    city: string;
    country: string;
    language: string;
    lat?: number;
    lng?: number;
  }
) {
  let score = 0;
  const id = normalizeSearch(church.id);
  const name = normalizeSearch(church.name);
  const q = params.q;
  const cityKey = normalizeGeo(params.city) || normalizeSearch(params.city);
  const countryKey = normalizeGeo(params.country) || normalizeSearch(params.country);
  const language = normalizeSearch(params.language);
  const churchCity = String((church as any).normalizedCity || normalizeGeo(church.city) || "");
  const churchCountry = String((church as any).normalizedCountry || normalizeGeo(church.country) || "");
  const churchLanguage = normalizeSearch((church as any).primaryLanguage || "");

  if (q) {
    if (id === q) score += 1000;
    else if (id.includes(q)) score += 700;
    if (name === q) score += 900;
    else if (name.includes(q)) score += 500;
    if (textHaystack(church).includes(q)) score += 120;
  }

  if (cityKey && churchCity && churchCity === cityKey) score += 220;
  else if (cityKey && normalizeSearch(church.city).includes(cityKey)) score += 140;

  if (countryKey && churchCountry && churchCountry === countryKey) score += 180;
  else if (countryKey && normalizeSearch(church.country).includes(countryKey)) score += 100;

  if (language && churchLanguage && churchLanguage === language) score += 120;

  if (isVerifiedChurch(church)) score += 80;

  if (!q && !cityKey && !countryKey) {
    score += Math.max(0, 40 - Math.floor((Date.now() - Date.parse(church.updatedAt || church.createdAt || "")) / 86400000));
  }

  return score;
}

export async function searchChurches(params: {
  q?: string;
  city?: string;
  country?: string;
  language?: string;
  lat?: number;
  lng?: number;
  limit?: number;
  includeDev?: boolean;
}): Promise<ChurchSearchHit[]> {
  const q = normalizeSearch(params.q);
  const city = normalizeSearch(params.city);
  const country = normalizeSearch(params.country);
  const language = normalizeSearch(params.language);
  const limit = Math.max(1, Math.min(Number(params.limit || 25) || 25, 50));

  let rows = await readAll();

  if (!params.includeDev) {
    rows = rows.filter((c) => !isHiddenFromSearch(c.id));
  }

  if (q) {
    rows = rows.filter((c) => {
      const hay = textHaystack(c);
      return hay.includes(q) || normalizeSearch(c.id).includes(q);
    });
  }

  const ranked = rows
    .map((church) => ({
      ...church,
      score: scoreChurch(church, { q, city, country, language, lat: params.lat, lng: params.lng }),
      verified: isVerifiedChurch(church),
      distanceKm: null as number | null,
      countryCode: countryCodeFor(church),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  return ranked.slice(0, limit);
}

export async function upsertChurchProfile(
  input: Pick<ChurchProfile, "id"> & Partial<Omit<ChurchProfile, "id" | "createdAt" | "updatedAt">>
): Promise<ChurchProfile> {
  if (usePostgres()) {
    await ensureStore();
    const existing = await dbGetChurchById(input.id);
    const saved: ChurchProfile = {
      ...(existing || {}),
      ...input,
      id: input.id,
      name: String(input.name || existing?.name || input.id),
      normalizedCountry: normalizeGeo((input as any).country) ?? existing?.normalizedCountry,
      normalizedProvince: normalizeGeo((input as any).province) ?? existing?.normalizedProvince,
      normalizedCity: normalizeGeo((input as any).city) ?? existing?.normalizedCity,
      phoneCountryCode: phoneCountryCode((input as any).phone) ?? existing?.phoneCountryCode,
      primaryLanguage:
        clean((input as any).primaryLanguage, 20) ??
        existing?.primaryLanguage ??
        languageHint((input as any).country),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    const result = await dbUpsertChurch(saved);
    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[churches] upsert postgres", { churchId: result.id, name: result.name });
    }
    return result;
  }

  let saved!: ChurchProfile;

  await updateJsonFile<ChurchProfile[]>(
    STORE_FILE,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      const idx = list.findIndex((c) => c.id === input.id);

      if (idx >= 0) {
        const prev = list[idx];
        saved = {
          ...prev,
          ...input,
          updatedAt: nowIso(),
        };
        list[idx] = saved;
        return list;
      }

      saved = {
        id: input.id,
        name: String(input.name || input.id),
        address: input.address,
        phone: input.phone,
        pastorName: input.pastorName,
        country: (input as any).country,
        province: (input as any).province,
        city: (input as any).city,
        normalizedCountry: normalizeGeo((input as any).country),
        normalizedProvince: normalizeGeo((input as any).province),
        normalizedCity: normalizeGeo((input as any).city),
        phoneCountryCode: phoneCountryCode((input as any).phone),
        primaryLanguage: clean((input as any).primaryLanguage, 20) ?? languageHint((input as any).country),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      list.unshift(saved);
      return list;
    },
    []
  );

  return saved;
}


export async function patchChurchProfile(
  churchId: string,
  input: {
    name?: unknown;
    address?: unknown;
    phone?: unknown;
    pastorName?: unknown;
    country?: unknown;
    province?: unknown;
    city?: unknown;
    primaryLanguage?: unknown;
    avatarUri?: unknown;
    avatarUrl?: unknown;
  }
): Promise<ChurchProfile> {
  if (usePostgres()) {
    await ensureStore();
    const prev = (await dbGetChurchById(churchId)) || ({ id: churchId, name: churchId, createdAt: nowIso() } as ChurchProfile);
    const nextName = clean(input.name, 120);
    const nextAddress = clean(input.address, 180);
    const nextPhone = clean(input.phone, 60);
    const nextPastorName = clean(input.pastorName, 120);
    const nextCountry = clean(input.country, 120);
    const nextProvince = clean(input.province, 120);
    const nextCity = clean(input.city, 120);
    const nextPrimaryLanguage = clean(input.primaryLanguage, 20) ?? languageHint(nextCountry);
    const nextAvatarUri = avatarField(input.avatarUri, prev.avatarUri);
    const nextAvatarUrl = avatarField(input.avatarUrl, prev.avatarUrl) ?? nextAvatarUri;

    const saved: ChurchProfile = {
      ...prev,
      name: nextName ?? prev.name,
      address: nextAddress ?? prev.address,
      phone: nextPhone ?? prev.phone,
      pastorName: nextPastorName ?? prev.pastorName,
      country: nextCountry ?? prev.country,
      province: nextProvince ?? (prev as any).province,
      city: nextCity ?? prev.city,
      normalizedCountry: normalizeGeo(nextCountry) ?? (prev as any).normalizedCountry,
      normalizedProvince: normalizeGeo(nextProvince) ?? (prev as any).normalizedProvince,
      normalizedCity: normalizeGeo(nextCity) ?? (prev as any).normalizedCity,
      phoneCountryCode: phoneCountryCode(nextPhone) ?? (prev as any).phoneCountryCode,
      primaryLanguage: nextPrimaryLanguage ?? (prev as any).primaryLanguage,
      avatarUri: nextAvatarUri ?? prev.avatarUri,
      avatarUrl: nextAvatarUrl ?? prev.avatarUrl,
      updatedAt: nowIso(),
    };
    return dbUpsertChurch(saved);
  }

  let saved!: ChurchProfile;

  await updateJsonFile<ChurchProfile[]>(
    STORE_FILE,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      const idx = list.findIndex((c) => c.id === churchId);
      const prevRow = idx >= 0 ? list[idx] : undefined;

      const nextName = clean(input.name, 120);
      const nextAddress = clean(input.address, 180);
      const nextPhone = clean(input.phone, 60);
      const nextPastorName = clean(input.pastorName, 120);
      const nextCountry = clean(input.country, 120);
      const nextProvince = clean(input.province, 120);
      const nextCity = clean(input.city, 120);
      const nextPrimaryLanguage = clean(input.primaryLanguage, 20) ?? languageHint(nextCountry);
      const nextAvatarUri = avatarField(input.avatarUri, prevRow?.avatarUri);
      const nextAvatarUrl = avatarField(input.avatarUrl, prevRow?.avatarUrl) ?? nextAvatarUri;

      if (idx >= 0) {
        const prev = list[idx];
        saved = {
          ...prev,
          name: nextName ?? prev.name,
          address: nextAddress ?? prev.address,
          phone: nextPhone ?? prev.phone,
          pastorName: nextPastorName ?? prev.pastorName,
          country: nextCountry ?? prev.country,
          province: nextProvince ?? (prev as any).province,
          city: nextCity ?? prev.city,
          normalizedCountry: normalizeGeo(nextCountry) ?? (prev as any).normalizedCountry,
          normalizedProvince: normalizeGeo(nextProvince) ?? (prev as any).normalizedProvince,
          normalizedCity: normalizeGeo(nextCity) ?? (prev as any).normalizedCity,
          phoneCountryCode: phoneCountryCode(nextPhone) ?? (prev as any).phoneCountryCode,
          primaryLanguage: nextPrimaryLanguage ?? (prev as any).primaryLanguage,
          avatarUri: nextAvatarUri ?? prev.avatarUri,
          avatarUrl: nextAvatarUrl ?? prev.avatarUrl,
          updatedAt: nowIso(),
        };
        list[idx] = saved;
        return list;
      }

      saved = {
        id: churchId,
        name: nextName || churchId,
        address: nextAddress,
        phone: nextPhone,
        pastorName: nextPastorName,
        country: nextCountry,
        province: nextProvince,
        city: nextCity,
        normalizedCountry: normalizeGeo(nextCountry),
        normalizedProvince: normalizeGeo(nextProvince),
        normalizedCity: normalizeGeo(nextCity),
        phoneCountryCode: phoneCountryCode(nextPhone),
        primaryLanguage: nextPrimaryLanguage,
        avatarUri: nextAvatarUri,
        avatarUrl: nextAvatarUrl,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      list.unshift(saved);
      return list;
    },
    []
  );

  return saved;
}
