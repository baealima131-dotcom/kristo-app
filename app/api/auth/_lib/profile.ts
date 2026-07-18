import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import {
  dbFindProfileByUserCode,
  dbFindUserByKristoId,
  dbGetProfile,
  dbGetUserById,
  dbUpsertProfile,
  ensureAuthStoreReady,
  hasDurableStore,
} from "@/app/api/_lib/store/authDb";
import {
  localGetUserById,
} from "@/app/api/_lib/store/localAuthStore";

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
  showChurchId?: boolean;
  showKristoId?: boolean;

  showGender?: boolean;
  showCountry?: boolean;
  showCity?: boolean;
  showMaritalStatus?: boolean;
  showLanguages?: boolean;
  showProfileFact?: boolean;
  showMemberSince?: boolean;
  showChurchHistory?: boolean;

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

  languages?: string[];
  profileFact?: string;

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

/**
 * Resolve a public/external identity by canonical user id, Kristo code, or
 * account row — independent of church membership.
 */
export async function resolveCanonicalUserIdentity(rawId: string): Promise<{
  userId: string;
  profile: UserProfile | null;
  account: { id: string; kristoId?: string; email?: string; phone?: string } | null;
} | null> {
  await ensureAuthStoreReady();
  const target = String(rawId || "").trim();
  if (!target) return null;

  async function loadAccount(id: string) {
    const uid = String(id || "").trim();
    if (!uid) return null;
    return hasDurableStore()
      ? dbGetUserById(uid)
      : localGetUserById(uid);
  }

  let profile = await getProfile(target).catch(() => null);
  if (!profile) {
    profile = await getProfileByUserCode(target).catch(() => null);
  }

  let account =
    (await loadAccount(
      String((profile as any)?.userId || target).trim()
    ).catch(() => null)) || null;

  if (!account) {
    account = (await loadAccount(target).catch(() => null)) || null;
  }

  if (!account && !profile && hasDurableStore()) {
    account = (await dbFindUserByKristoId(target).catch(() => null)) || null;
    if (account?.id) {
      profile = await getProfile(account.id).catch(() => null);
    }
  }

  const userId = String(
    (profile as any)?.userId ||
      (profile as any)?.id ||
      account?.id ||
      ""
  ).trim();

  if (!userId) return null;

  if (!profile && account?.id) {
    profile = await getProfile(account.id).catch(() => null);
  }

  return {
    userId,
    profile,
    account: account
      ? {
          id: account.id,
          kristoId: account.kristoId,
          email: account.email,
          phone: account.phone,
        }
      : null,
  };
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
    showChurchId: true,
    showKristoId: true,

    showGender: false,
    showCountry: true,
    showCity: false,
    showMaritalStatus: false,
    showLanguages: true,
    showProfileFact: true,
    showMemberSince: true,
    showChurchHistory: false,

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
    showChurchId:
      "showChurchId" in src
        ? Boolean((src as any).showChurchId)
        : base.showChurchId,
    showKristoId:
      "showKristoId" in src
        ? Boolean((src as any).showKristoId)
        : base.showKristoId,

    showGender:
      "showGender" in src
        ? Boolean((src as any).showGender)
        : base.showGender,

    showCountry:
      "showCountry" in src
        ? Boolean((src as any).showCountry)
        : base.showCountry,

    showCity:
      "showCity" in src
        ? Boolean((src as any).showCity)
        : base.showCity,

    showMaritalStatus:
      "showMaritalStatus" in src
        ? Boolean((src as any).showMaritalStatus)
        : base.showMaritalStatus,

    showLanguages:
      "showLanguages" in src
        ? Boolean((src as any).showLanguages)
        : base.showLanguages,

    showProfileFact:
      "showProfileFact" in src
        ? Boolean((src as any).showProfileFact)
        : base.showProfileFact,

    showMemberSince:
      "showMemberSince" in src
        ? Boolean((src as any).showMemberSince)
        : base.showMemberSince,

    showChurchHistory:
      "showChurchHistory" in src
        ? Boolean((src as any).showChurchHistory)
        : base.showChurchHistory,

    privateMode:
      "privateMode" in src
        ? Boolean((src as any).privateMode)
        : base.privateMode,
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
    languages: [],
    profileFact: "",
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
