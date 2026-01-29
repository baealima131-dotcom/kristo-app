import bcrypt from "bcryptjs";
import crypto from "crypto";

/** VIP Auth Types */
export type Gender = "MALE" | "FEMALE";

export type VipUser = {
  id: string;
  email: string; // normalized lower-case
  passwordHash: string;
  createdAt: string;
};

export type VipSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type VipProfile = {
  userId: string;
  fullName: string;
  gender: Gender;
  dob: string; // YYYY-MM-DD
  phone: string;
  country: string;
  city: string;
  createdAt: string;
  updatedAt?: string;
};

/** Persist in dev via globalThis (like your ministries store pattern) */
declare global {
  var __KRISTO_VIP_USERS__: VipUser[] | undefined;
  var __KRISTO_VIP_SESSIONS__: VipSession[] | undefined;
  var __KRISTO_VIP_PROFILES__: VipProfile[] | undefined;
}

function usersStore() {
  if (!globalThis.__KRISTO_VIP_USERS__) globalThis.__KRISTO_VIP_USERS__ = [];
  return globalThis.__KRISTO_VIP_USERS__;
}
function sessionsStore() {
  if (!globalThis.__KRISTO_VIP_SESSIONS__) globalThis.__KRISTO_VIP_SESSIONS__ = [];
  return globalThis.__KRISTO_VIP_SESSIONS__;
}
function profilesStore() {
  if (!globalThis.__KRISTO_VIP_PROFILES__) globalThis.__KRISTO_VIP_PROFILES__ = [];
  return globalThis.__KRISTO_VIP_PROFILES__;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** ===== Users ===== */
export async function vipCreateUser(email: string, password: string) {
  const store = usersStore();
  const normalized = email.trim().toLowerCase();

  if (store.some((u) => u.email === normalized)) {
    return { ok: false as const, error: "Email tayari imeshasajiliwa." };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user: VipUser = {
    id: newId("u"),
    email: normalized,
    passwordHash,
    createdAt: nowIso(),
  };

  store.push(user);
  return { ok: true as const, user };
}

export async function vipVerifyUser(email: string, password: string) {
  const store = usersStore();
  const normalized = email.trim().toLowerCase();
  const user = store.find((u) => u.email === normalized);

  if (!user) return { ok: false as const, error: "Email au password si sahihi." };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { ok: false as const, error: "Email au password si sahihi." };

  return { ok: true as const, user };
}

export function vipGetUserById(userId: string) {
  return usersStore().find((u) => u.id === userId) || null;
}

/** ===== Sessions ===== */
export function vipCreateSession(userId: string, ttlDays = 14) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const session: VipSession = {
    id: newId("s"),
    userId,
    tokenHash,
    expiresAt,
    createdAt: nowIso(),
  };

  sessionsStore().push(session);
  return { ok: true as const, session, rawToken };
}

export function vipFindSessionByToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const s = sessionsStore().find((x) => x.tokenHash === tokenHash);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) return null;
  return s;
}

export function vipRevokeSessionByToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const store = sessionsStore();
  const idx = store.findIndex((x) => x.tokenHash === tokenHash);
  if (idx >= 0) store.splice(idx, 1);
}

/** ===== Profiles ===== */
export function vipUpsertProfile(input: Omit<VipProfile, "createdAt" | "updatedAt">) {
  const store = profilesStore();
  const existing = store.find((p) => p.userId === input.userId);

  if (!existing) {
    const profile: VipProfile = { ...input, createdAt: nowIso() };
    store.push(profile);
    return profile;
  }

  existing.fullName = input.fullName;
  existing.gender = input.gender;
  existing.dob = input.dob;
  existing.phone = input.phone;
  existing.country = input.country;
  existing.city = input.city;
  existing.updatedAt = nowIso();
  return existing;
}

export function vipGetProfile(userId: string) {
  return profilesStore().find((p) => p.userId === userId) || null;
}
