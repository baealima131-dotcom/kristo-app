export type Gender = "MALE" | "FEMALE";

export type DobVisibility = "Private" | "CorePastor" | "Public";
export type MaritalVisibility = "Private" | "CorePastor" | "Public";

export type MaritalStatus = "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";

export type CoreIdsParents = { fatherCoreId?: string; motherCoreId?: string };

export type ProfileStatus = "Incomplete" | "Complete" | "Locked";

export type UserProfile = {
  userId: string;

  // Core v1 (expandable)
  coreId: string; // household core (MVP)
  coreIdBirth: string; // origin birth core (MVP = coreId at start)
  coreIdsParents?: CoreIdsParents; // for child accounts (optional for now)

  // Basics
  fullName: string;
  gender?: Gender;
  dob?: string; // YYYY-MM-DD
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;



  // Privacy + status
  dobVisibility: DobVisibility; // default Private
  maritalStatus: MaritalStatus; // default SINGLE
  maritalVisibility: MaritalVisibility; // default CorePastor

  profileStatus: ProfileStatus;

  createdAt: number;
  updatedAt: number;
};

declare global {
  var __KRISTO_PROFILES__: Record<string, UserProfile> | undefined;
}

function store() {
  if (!globalThis.__KRISTO_PROFILES__) globalThis.__KRISTO_PROFILES__ = {};
  return globalThis.__KRISTO_PROFILES__;
}

export function getProfile(userId: string) {
  const s = store();
  return s[userId] || null;
}

export function upsertProfile(profile: UserProfile) {
  const s = store();
  s[profile.userId] = profile;
  return s[profile.userId];
}

export function ensureProfileDraft(params: {
  userId: string;
  email?: string;
  phone?: string;
  fullName?: string;
  gender?: Gender;
  dob?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;

}) {
  const now = Date.now();
  const existing = getProfile(params.userId);
  if (existing) return existing;

  const coreId = params.userId; // MVP: coreId = userId
  const p: UserProfile = {
    userId: params.userId,
    coreId,
    coreIdBirth: coreId,

    fullName: String(params.fullName || ""),
    gender: params.gender,
    dob: params.dob ? String(params.dob) : undefined,

    email: params.email,
    phone: params.phone,
    country: params.country,
    city: params.city,

    avatarUrl: "",

    dobVisibility: "Private",
    maritalStatus: "SINGLE",
    maritalVisibility: "CorePastor",

    profileStatus: "Incomplete",

    createdAt: now,
    updatedAt: now,
  };

  return upsertProfile(p);
}

export function computeProfileStatus(p: Partial<UserProfile>): ProfileStatus {
  // MVP rule: ili uwe Active, lazima hizi ziwepo
  const fullName = String(p.fullName || "").trim();
  const phone = String(p.phone || "").trim();
  const dob = String(p.dob || "").trim();
  const country = String(p.country || "").trim();
  const city = String(p.city || "").trim();

  if (!fullName || !phone || !dob || !country || !city) return "Incomplete";
  return "Complete";
}
