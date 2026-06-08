import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  dbCountUsers,
  dbCreateUser,
  dbDeleteProfile,
  dbDeleteUser,
  dbEmailTaken,
  dbFindUserByEmail,
  dbFindUserByPhone,
  dbGetUserById,
  dbPhoneTaken,
  dbUpdateUser,
  ensureAuthStoreReady,
  hasDurableStore,
  type UserRecord,
} from "@/app/api/_lib/store/authDb";
import {
  localCountUsers,
  localCreateUser,
  localDeleteUser,
  localEmailTaken,
  localFindUserByEmail,
  localFindUserByPhone,
  localGetUserById,
  localPhoneTaken,
  localUpdateUser,
  normEmailLocal,
  normPhoneLocal,
} from "@/app/api/_lib/store/localAuthStore";
import { resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";

export type IdentifierType = "email" | "phone";
export type UserLite = UserRecord;

type OtpChallenge = {
  id: string;
  identifierType: IdentifierType;
  identifier: string;
  code: string;
  expiresAt: number;
  tries: number;
  userId: string;
  lastSentAt?: number;
};

type Session = {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

declare global {
  var __KRISTO_OTP__: Record<string, OtpChallenge> | undefined;
  var __KRISTO_OTP_ACTIVE__: Record<string, { challengeId: string; issuedAt: number; expiresAt: number }> | undefined;
  var __KRISTO_SESS__: Record<string, Session> | undefined;
}

function otpStore() {
  if (!globalThis.__KRISTO_OTP__) globalThis.__KRISTO_OTP__ = {};
  return globalThis.__KRISTO_OTP__;
}

function sessStore() {
  if (!globalThis.__KRISTO_SESS__) globalThis.__KRISTO_SESS__ = {};
  return globalThis.__KRISTO_SESS__;
}

function normEmail(s: string) {
  return normEmailLocal(s);
}

function normPhone(s: string) {
  return normPhoneLocal(s);
}

function authDebugEnabled() {
  return process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production";
}

function devAutoSession(): Session | null {
  if (process.env.NODE_ENV !== "development") return null;
  if (process.env.KRISTO_DEV_AUTO_LOGIN !== "1") return null;

  const userId = process.env.KRISTO_DEV_USER_ID || "u-demo-1";
  const now = Date.now();
  const H12 = 12 * 60 * 60 * 1000;

  return {
    id: "dev-session",
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + H12,
  };
}

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function makeKristoId() {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  const digits = String(Date.now()).slice(-5);
  return `KR7-${digits}${n.slice(-1)}${r.slice(0, 1)}`;
}

export async function seedUserIfMissing() {
  await ensureAuthStoreReady();

  const count = hasDurableStore() ? await dbCountUsers() : await localCountUsers();
  if (count > 0) return;

  const demo: UserRecord = {
    id: "u-demo-1",
    kristoId: "KR7-DEMO1",
    email: "demo@kristo.local",
    phone: "+15555550123",
    password: bcrypt.hashSync("Password123", 10),
    lastSeenAt: Date.now(),
    lastOtpAt: Date.now(),
  };

  if (hasDurableStore()) {
    await dbCreateUser(demo);
  } else {
    await localCreateUser(demo);
  }
}

export async function createUser(params: { email?: string; phone?: string; password: string }) {
  await ensureAuthStoreReady();

  const email = params.email ? normEmail(params.email) : "";
  const phone = params.phone ? normPhone(params.phone) : "";

  if (email) {
    const taken = hasDurableStore() ? await dbEmailTaken(email) : await localEmailTaken(email);
    if (taken) {
      return {
        ok: false as const,
        error: "This email is already registered. Sign in to continue.",
        reason: "account_exists" as const,
      };
    }
  }
  if (phone) {
    const taken = hasDurableStore() ? await dbPhoneTaken(phone) : await localPhoneTaken(phone);
    if (taken) return { ok: false as const, error: "Phone tayari imesajiliwa." };
  }

  const user: UserRecord = {
    id: makeId("u"),
    kristoId: makeKristoId(),
    email: email || undefined,
    phone: phone || undefined,
    password: bcrypt.hashSync(String(params.password || ""), 10),
    lastSeenAt: Date.now(),
    lastOtpAt: 0,
  };

  const saved = hasDurableStore() ? await dbCreateUser(user) : await localCreateUser(user);
  return { ok: true as const, user: saved };
}

export async function findUserByIdentifier(identifierType: IdentifierType, identifier: string) {
  await ensureAuthStoreReady();

  const raw = String(identifier || "").trim();
  const key = identifierType === "email" ? normEmail(raw) : normPhone(raw);

  if (authDebugEnabled()) {
    console.log("[KRISTO AUTH LOOKUP]", {
      store: hasDurableStore() ? "postgres" : "local-json",
      identifierType,
      rawIdentifier: identifierType === "email" ? key : raw,
      normalizedKey: key,
    });
  }

  let hit: UserRecord | null = null;
  if (identifierType === "email") {
    hit = hasDurableStore() ? await dbFindUserByEmail(key) : await localFindUserByEmail(key);
  } else if (identifierType === "phone") {
    hit = hasDurableStore() ? await dbFindUserByPhone(raw) : await localFindUserByPhone(raw);
  }

  if (authDebugEnabled()) {
    console.log("[KRISTO AUTH LOOKUP RESULT]", {
      identifierType,
      normalizedKey: key,
      found: Boolean(hit),
      userId: hit?.id || null,
    });
  }

  return hit;
}

export async function getUserById(userId: string) {
  await ensureAuthStoreReady();
  return hasDurableStore() ? dbGetUserById(userId) : localGetUserById(userId);
}

export async function deleteUserById(userId: string) {
  await ensureAuthStoreReady();
  if (hasDurableStore()) {
    await dbDeleteProfile(userId);
    await dbDeleteUser(userId);
  } else {
    await localDeleteUser(userId);
  }
}

export function deleteChallengesForUser(userId: string) {
  const store = otpStore();
  for (const [id, ch] of Object.entries(store)) {
    if (ch.userId === userId) delete store[id];
  }
}

export async function rollbackSignupUser(userId: string) {
  deleteChallengesForUser(userId);
  await deleteUserById(userId);
}

export async function touchUser(userId: string) {
  await updateUserPersist(userId, { lastSeenAt: Date.now() });
}

export async function updateUserPersist(userId: string, patch: Partial<UserRecord>) {
  await ensureAuthStoreReady();
  return hasDurableStore()
    ? await dbUpdateUser(userId, patch)
    : await localUpdateUser(userId, patch);
}

/** Drop in-memory cookie sessions for a user (e.g. explicit logout-all). */
export function invalidateUserSessions(userId: string) {
  const sess = sessStore();
  for (const [sid, s] of Object.entries(sess)) {
    if (s.userId === userId) delete sess[sid];
  }
}

export async function ensureUserKristoId(user: UserRecord) {
  if (user.kristoId) return user.kristoId;
  const kristoId = makeKristoId();
  await updateUserPersist(user.id, { kristoId });
  user.kristoId = kristoId;
  return kristoId;
}

export function makeOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const OTP_EXPIRES_MS = 10 * 60 * 1000;

type SignedOtpPayload = {
  v: 1;
  userId: string;
  identifier: string;
  identifierType: IdentifierType;
  codeHash: string;
  expiresAt: number;
  issuedAt: number;
};

function getOtpSecret() {
  return (
    process.env.KRISTO_OTP_SECRET?.trim() ||
    process.env.RESEND_API_KEY?.trim() ||
    "kristo-dev-otp-secret"
  );
}

function hashOtpCode(code: string) {
  return crypto.createHmac("sha256", getOtpSecret()).update(String(code || "").trim()).digest("hex");
}

function otpActiveKey(userId: string, identifierType: IdentifierType, identifier: string) {
  const id = identifierType === "email" ? normEmail(identifier) : normPhone(identifier);
  return `${userId}::${identifierType}::${id}`;
}

function activeOtpStore() {
  if (!globalThis.__KRISTO_OTP_ACTIVE__) globalThis.__KRISTO_OTP_ACTIVE__ = {};
  return globalThis.__KRISTO_OTP_ACTIVE__;
}

function makeSignedChallengeId(payload: SignedOtpPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getOtpSecret()).update(body).digest("base64url");
  return `otpt.v1.${body}.${sig}`;
}

function parseSignedChallengeId(challengeId: string): SignedOtpPayload | null {
  if (!challengeId.startsWith("otpt.v1.")) return null;
  const rest = challengeId.slice("otpt.v1.".length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const expected = crypto.createHmac("sha256", getOtpSecret()).update(body).digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedOtpPayload;
  } catch {
    return null;
  }
}

export function createChallenge(params: { identifierType: IdentifierType; identifier: string; userId: string }) {
  const store = otpStore();
  const active = activeOtpStore();
  const activeKey = otpActiveKey(params.userId, params.identifierType, params.identifier);
  const now = Date.now();

  const current = active[activeKey];
  if (current && now < current.expiresAt) {
    const existing = store[current.challengeId];
    if (existing) return existing;
  }

  for (const [id, ch] of Object.entries(store)) {
    if (
      ch.userId === params.userId &&
      ch.identifier === params.identifier &&
      ch.identifierType === params.identifierType
    ) {
      delete store[id];
    }
  }

  const code = makeOtpCode();
  const expiresAt = now + OTP_EXPIRES_MS;
  const issuedAt = now;
  const id = makeSignedChallengeId({
    v: 1,
    userId: params.userId,
    identifier: params.identifier,
    identifierType: params.identifierType,
    codeHash: hashOtpCode(code),
    expiresAt,
    issuedAt,
  });

  const challenge: OtpChallenge = {
    id,
    code,
    expiresAt,
    tries: 0,
    userId: params.userId,
    identifier: params.identifier,
    identifierType: params.identifierType,
    lastSentAt: 0,
  };

  store[id] = challenge;
  active[activeKey] = { challengeId: id, issuedAt, expiresAt };
  return challenge;
}

export function resendChallenge(challengeId: string) {
  const store = otpStore();
  const ch = store[challengeId];
  if (!ch) return { ok: false as const, status: 400 as const, error: "Challenge haipo. Rudi nyuma uanze tena." };

  const now = Date.now();
  const COOLDOWN_MS = 30 * 1000;
  const last = ch.lastSentAt || 0;

  if (last && now - last < COOLDOWN_MS) {
    const left = Math.max(1, Math.ceil((COOLDOWN_MS - (now - last)) / 1000));
    return { ok: false as const, status: 429 as const, error: `Subiri sekunde ${left} kisha ujaribu tena.` };
  }

  ch.code = makeOtpCode();
  ch.expiresAt = now + 10 * 60 * 1000;
  ch.tries = 0;
  ch.lastSentAt = now;

  return { ok: true as const, challenge: ch };
}

export function verifyChallenge(id: string, code: string) {
  const normalizedCode = String(code || "").trim();
  const signed = parseSignedChallengeId(id);

  if (signed) {
    const activeKey = otpActiveKey(signed.userId, signed.identifierType, signed.identifier);
    const active = activeOtpStore()[activeKey];

    if (Date.now() > signed.expiresAt) {
      return { ok: false as const, error: "Code expired or replaced.", reason: "expired" as const };
    }

    if (active && active.challengeId !== id) {
      return { ok: false as const, error: "A newer verification code was already sent.", reason: "superseded" as const };
    }

    if (active && signed.issuedAt < active.issuedAt) {
      return { ok: false as const, error: "A newer verification code was already sent.", reason: "superseded" as const };
    }

    if (hashOtpCode(normalizedCode) !== signed.codeHash) {
      return { ok: false as const, error: "Invalid code.", reason: "invalid_code" as const };
    }

    delete activeOtpStore()[activeKey];
    delete otpStore()[id];
    return { ok: true as const, userId: signed.userId };
  }

  const store = otpStore();
  const ch = store[id];
  if (!ch) {
    return { ok: false as const, error: "Code expired or replaced.", reason: "expired" as const };
  }
  if (Date.now() > ch.expiresAt) {
    delete store[id];
    return { ok: false as const, error: "Code expired or replaced.", reason: "expired" as const };
  }
  ch.tries += 1;
  if (ch.tries > 6) {
    delete store[id];
    return { ok: false as const, error: "Too many attempts. Request a new code.", reason: "too_many_attempts" as const };
  }
  if (normalizedCode !== ch.code) {
    return { ok: false as const, error: "Invalid code.", reason: "invalid_code" as const };
  }
  delete store[id];
  return { ok: true as const, userId: ch.userId };
}

export function requiredAuthForUser(user: UserRecord | null) {
  const now = Date.now();
  const last = user?.lastSeenAt || 0;
  if (!last) return "otp" as const;

  const delta = now - last;
  const H12 = 12 * 60 * 60 * 1000;
  const H24 = 24 * 60 * 60 * 1000;

  if (delta <= H12) return "none" as const;
  if (delta <= H24) return "password" as const;
  return "otp" as const;
}

export const SESSION_COOKIE = "kristo_session";
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SEC * 1000;

export function createSession(userId: string) {
  const store = sessStore();
  const id = makeId("sess");
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;
  store[id] = { id, userId, createdAt: now, lastSeenAt: now, expiresAt };
  return store[id];
}

export async function readSession(req?: any) {
  try {
    // Header identity is only trusted with a valid signed session token in
    // production (raw header still allowed in dev / KRISTO_DEV_HEADER_AUTH=1).
    const headerUserId = resolveRequestUserId(req).userId;
    if (headerUserId) {
      const now = Date.now();
      return {
        id: `header-session-${headerUserId}`,
        userId: headerUserId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + SESSION_MAX_AGE_MS,
      };
    }
  } catch {}

  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value || "";
  if (sid) {
    const store = sessStore();
    const s = store[sid];
    if (s && Date.now() <= s.expiresAt) return s;
    if (s) delete store[sid];
  }

  return devAutoSession();
}

export async function touchSession(sessionId: string) {
  if (sessionId.startsWith("header-session-")) return;

  const store = sessStore();
  const s = store[sessionId];
  if (!s) return;

  s.lastSeenAt = Date.now();
  await updateUserPersist(s.userId, { lastSeenAt: Date.now() });
}

export function setSessionCookie<T>(res: NextResponse<T>, sessionId: string): NextResponse<T> {
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}

export function clearSessionCookie<T>(res: NextResponse<T>): NextResponse<T> {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
