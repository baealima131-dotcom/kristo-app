import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export type IdentifierType = "email" | "phone";

type UserLite = {
  id: string;
  email?: string;
  phone?: string;
  password: string; // DEMO: (baadaye tuta-hash)
  lastSeenAt?: number; // last time user was "inside app"
  lastOtpAt?: number; // last time OTP verified
};

type OtpChallenge = {
  id: string;
  identifierType: IdentifierType;
  identifier: string;
  code: string;
  expiresAt: number;
  tries: number;
  userId: string;
  lastSentAt?: number; // resend cooldown
};

type Session = {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number; // for 12h rule
  expiresAt: number; // hard expiry
};

declare global {
  var __KRISTO_USERS__: UserLite[] | undefined;
  var __KRISTO_OTP__: Record<string, OtpChallenge> | undefined;
  var __KRISTO_SESS__: Record<string, Session> | undefined;
}

function usersStore() {
  if (!globalThis.__KRISTO_USERS__) globalThis.__KRISTO_USERS__ = [];
  return globalThis.__KRISTO_USERS__;
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
  return String(s || "").trim().toLowerCase();
}
function normPhone(s: string) {
  return String(s || "").trim();
}


/* =========================
   DEV AUTO SESSION (NO SIGN-IN)
   ========================= */
function devAutoSession(): Session | null {
  if (process.env.NODE_ENV !== "development") return null;
  if (process.env.KRISTO_DEV_AUTO_LOGIN === "0") return null;

  const userId = process.env.KRISTO_DEV_USER_ID || "u-demo-1";
  const now = Date.now();
  const H12 = 12 * 60 * 60 * 1000;

  // Session that always counts as "recent" in dev (so no sign-in prompt)
  return {
    id: "dev-session",
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + H12,
  };
}

export function seedUserIfMissing() {
  const u = usersStore();
  if (u.length === 0) {
    u.push({
      id: "u-demo-1",
      email: "demo@kristo.app",
      phone: "+15555550123",
      password: "Password123",
      lastSeenAt: Date.now(),
      lastOtpAt: Date.now(),
    });
  }
}

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function createUser(params: { email?: string; phone?: string; password: string }) {
  const store = usersStore();

  const email = params.email ? normEmail(params.email) : "";
  const phone = params.phone ? normPhone(params.phone) : "";

  if (email && store.some((u) => normEmail(u.email || "") === email)) {
    return { ok: false as const, error: "Email tayari imesajiliwa." };
  }
  if (phone && store.some((u) => normPhone(u.phone || "") === phone)) {
    return { ok: false as const, error: "Phone tayari imesajiliwa." };
  }

  const user: UserLite = {
    id: makeId("u"),
    email: email || undefined,
    phone: phone || undefined,
    password: String(params.password || ""),
    lastSeenAt: Date.now(),
    lastOtpAt: 0,
  };

  store.push(user);
  return { ok: true as const, user };
}

export function findUserByIdentifier(identifierType: IdentifierType, identifier: string) {
  const u = usersStore();
  const raw = String(identifier || "").trim();
  const key = identifierType === "email" ? normEmail(raw) : normPhone(raw);

  if (identifierType === "email") return u.find((x) => normEmail(x.email || "") === key) || null;
  return u.find((x) => normPhone(x.phone || "") === key) || null;
}

export function getUserById(userId: string) {
  const u = usersStore();
  return u.find((x) => x.id === userId) || null;
}

export function touchUser(userId: string) {
  const u = getUserById(userId);
  if (!u) return;
  u.lastSeenAt = Date.now();
}

export function makeOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const OTP_EXPIRES_MS = 10 * 60 * 1000; // 10min
const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30s

export function createChallenge(params: { identifierType: IdentifierType; identifier: string; userId: string }) {
  const store = otpStore();
  const id = makeId("otp");
  const code = makeOtpCode();
  const now = Date.now();
  const expiresAt = now + OTP_EXPIRES_MS;

  store[id] = {
    id,
    code,
    expiresAt,
    tries: 0,
    userId: params.userId,
    identifier: params.identifier,
    identifierType: params.identifierType,
    lastSentAt: 0,
  };
  return store[id];
}

export function resendChallenge(challengeId: string) {
  const store = otpStore();
  const ch = store[challengeId];
  if (!ch) return { ok: false as const, status: 400 as const, error: "Challenge haipo. Rudi nyuma uanze tena." };

  const now = Date.now();
  const COOLDOWN_MS = 30 * 1000;
  const last = ch.lastSentAt || 0;

  // Option B: lastSentAt=0 => resend ya kwanza inaruhusiwa (hakuna cooldown)
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
  const store = otpStore();
  const ch = store[id];
  if (!ch) return { ok: false as const, error: "Challenge haipo. Anza tena." };
  if (Date.now() > ch.expiresAt) {
    delete store[id];
    return { ok: false as const, error: "Code ime-expire. Omba tena." };
  }
  ch.tries += 1;
  if (ch.tries > 6) {
    delete store[id];
    return { ok: false as const, error: "Umejaribu mara nyingi. Omba code mpya." };
  }
  if (String(code || "").trim() !== ch.code) return { ok: false as const, error: "Code si sahihi." };
  delete store[id];
  return { ok: true as const, userId: ch.userId };
}

/**
 * Rules:
 * - <= 12h since lastSeenAt => NO sign-in (auto)
 * - 12h..24h => password only
 * - > 24h OR unknown => OTP required
 */
export function requiredAuthForUser(user: UserLite | null) {
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

// Keep session cookie longer, but gate by lastSeenAt rules.
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SEC * 1000;

export function createSession(userId: string) {
  const store = sessStore();
  const id = makeId("sess");
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;
  store[id] = { id, userId, createdAt: now, lastSeenAt: now, expiresAt };
  return store[id];
}

export async function readSession() {
  const dev = devAutoSession();
  if (dev) return dev;

  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value || "";
  if (!sid) return null;

  const store = sessStore();
  const s = store[sid];
  if (!s) return null;

  if (Date.now() > s.expiresAt) {
    delete store[sid];
    return null;
  }
  return s;
}

export function touchSession(sessionId: string) {
  const store = sessStore();
  const s = store[sessionId];
  if (!s) return;
  s.lastSeenAt = Date.now();
  touchUser(s.userId);
}

export function setSessionCookie<T>(res: NextResponse<T>, sessionId: string): NextResponse<T> {
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // DEV; production true on https
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}

export function clearSessionCookie<T>(res: NextResponse<T>): NextResponse<T> {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0,
  });
  return res;
}
