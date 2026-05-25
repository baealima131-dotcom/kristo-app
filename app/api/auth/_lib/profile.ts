import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import {
  dbFindProfileByUserCode,
  dbGetProfile,
  dbUpsertProfile,
  ensureAuthStoreReady,
  hasDurableStore,
} from "@/app/api/_lib/store/authDb";

export type Gender = "MALE" | "FEMALE";

export type DobVisibility = "Private" | "CorePastor" | "Public";
export type MaritalVisibility = "Private" | "CorePastor" | "Public";

export type MaritalStatus = "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";

export type CoreIdsParents = { fatherCoreId?: string; motherCoreId?: string };

export type ProfileStatus = "Incomplete" | "Complete" | "Locked";

export type UserProfilePrivacy = {
  publicProfile?: boolean;
  showFollowers?: boolean;
  showFollowing?: boolean;
  allowMessages?: boolean;
  showPhone?: boolean;
  showChurch?: boolean;
  showAddress?: boolean;
  privateMode?: boolean;
};

export type UserProfile = {
  userId: string;

  coreId: string;
  coreIdBirth: string;
  userCode?: string;
  coreIdsParents?: CoreIdsParents;

  fullName: string;
  gender?: Gender;
  dob?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;
  bio?: string;

  dobVisibility: DobVisibility;
  maritalStatus: MaritalStatus;
  maritalVisibility: MaritalVisibility;

  privacy: UserProfilePrivacy;

  profileStatus: ProfileStatus;

  createdAt: number;
  updatedAt: number;
};

declare global {
  var __KRISTO_PROFILES__: Record<string, UserProfile> | undefined;
}

const STORE_FILE = "profiles.json";

function memoryStore() {
  if (!globalThis.__KRISTO_PROFILES__) globalThis.__KRISTO_PROFILES__ = {};
  return globalThis.__KRISTO_PROFILES__;
}

async function readProfilesFile() {
  return await readJsonFile<Record<string, UserProfile>>(STORE_FILE, {});
}

async function writeProfilesFile(data: Record<string, UserProfile>) {
  await writeJsonFile(STORE_FILE, data);
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  await ensureAuthStoreReady();

  if (hasDurableStore()) {
    return dbGetProfile(userId);
  }

  const mem = memoryStore()[userId];
  if (mem) return mem;

  const file = await readProfilesFile();
  return file[userId] || null;
}

export async function upsertProfilePersist(profile: UserProfile): Promise<UserProfile> {
  await ensureAuthStoreReady();

  const next = { ...profile, updatedAt: Date.now() };

  if (hasDurableStore()) {
    memoryStore()[profile.userId] = next;
    return dbUpsertProfile(next);
  }

  memoryStore()[profile.userId] = next;
  const file = await readProfilesFile();
  file[profile.userId] = next;
  await writeProfilesFile(file);
  return next;
}

export async function getProfileByUserCode(userCode: string): Promise<UserProfile | null> {
  await ensureAuthStoreReady();

  const code = String(userCode || "").trim().toUpperCase();
  if (!code) return null;

  if (hasDurableStore()) {
    return dbFindProfileByUserCode(code);
  }

  const inMemory =
    Object.values(memoryStore()).find((p) => String(p?.userCode || "").trim().toUpperCase() === code) || null;
  if (inMemory) return inMemory;

  const file = await readProfilesFile();
  return (
    Object.values(file).find((p: any) => {
      const userCodeValue = String(p?.userCode || "").trim().toUpperCase();
      const userId = String(p?.userId || "").trim().toUpperCase();
      const coreId = String(p?.coreId || "").trim().toUpperCase();
      const coreIdBirth = String(p?.coreIdBirth || "").trim().toUpperCase();
      return userCodeValue === code || userId === code || coreId === code || coreIdBirth === code;
    }) || null
  );
}

export function defaultPrivacy(): UserProfilePrivacy {
  return {
    publicProfile: true,
    showFollowers: true,
    showFollowing: true,
    allowMessages: true,
    showPhone: false,
    showChurch: true,
    showAddress: false,
    privateMode: false,
  };
}

export function normalizePrivacy(input?: Partial<UserProfilePrivacy> | null): UserProfilePrivacy {
  const base = defaultPrivacy();
  const src = input && typeof input === "object" ? input : {};

  return {
    publicProfile: "publicProfile" in src ? Boolean((src as any).publicProfile) : base.publicProfile,
    showFollowers: "showFollowers" in src ? Boolean((src as any).showFollowers) : base.showFollowers,
    showFollowing: "showFollowing" in src ? Boolean((src as any).showFollowing) : base.showFollowing,
    allowMessages: "allowMessages" in src ? Boolean((src as any).allowMessages) : base.allowMessages,
    showPhone: "showPhone" in src ? Boolean((src as any).showPhone) : base.showPhone,
    showChurch: "showChurch" in src ? Boolean((src as any).showChurch) : base.showChurch,
    showAddress: "showAddress" in src ? Boolean((src as any).showAddress) : base.showAddress,
    privateMode: "privateMode" in src ? Boolean((src as any).privateMode) : base.privateMode,
  };
}

export async function ensureProfileDraft(params: {
  userId: string;
  email?: string;
  phone?: string;
  fullName?: string;
  gender?: Gender;
  dob?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;
  bio?: string;
  userCode?: string;
}): Promise<UserProfile> {
  const existing = await getProfile(params.userId);
  if (existing) return existing;

  const now = Date.now();
  const coreId = params.userId;

  const p: UserProfile = {
    userId: params.userId,
    coreId,
    coreIdBirth: coreId,
    userCode: String((params as any).userCode || "").trim().toUpperCase() || undefined,
    fullName: String(params.fullName || ""),
    gender: params.gender,
    dob: params.dob ? String(params.dob) : undefined,
    email: params.email ? params.email.trim().toLowerCase() : undefined,
    phone: params.phone,
    country: params.country,
    city: params.city,
    avatarUrl: params.avatarUrl || "",
    bio: params.bio || "",
    dobVisibility: "Private",
    maritalStatus: "SINGLE",
    maritalVisibility: "CorePastor",
    privacy: defaultPrivacy(),
    profileStatus: "Incomplete",
    createdAt: now,
    updatedAt: now,
  };

  return upsertProfilePersist(p);
}

export function computeProfileStatus(p: Partial<UserProfile> & { hasChurch?: boolean }): ProfileStatus {
  const fullName = String(p.fullName || "").trim();
  const phone = String(p.phone || "").trim();
  const hasChurch = Boolean((p as any).hasChurch);

  if (!fullName || !phone) return "Incomplete";
  if (!hasChurch) return "Incomplete";

  return "Complete";
}
