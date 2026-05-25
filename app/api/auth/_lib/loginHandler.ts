import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  createSession,
  ensureUserKristoId,
  findUserByIdentifier,
  seedUserIfMissing,
  setSessionCookie,
} from "@/app/api/auth/_lib/session";
import { authDatabaseErrorResponse } from "@/app/api/auth/_lib/authErrors";

export const runtime = "nodejs";

type Body = { email?: string; identifier?: string; password?: string };

const LOGIN_ATTEMPTS = new Map<string, { count: number; lockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function loginKey(email: string) {
  return email.trim().toLowerCase();
}

function checkLoginLimit(email: string) {
  const key = loginKey(email);
  const now = Date.now();
  const item = LOGIN_ATTEMPTS.get(key);

  if (item?.lockedUntil && item.lockedUntil > now) {
    const retryAfter = Math.ceil((item.lockedUntil - now) / 1000);
    return {
      ok: false as const,
      error: "Too many attempts.",
      retryAfter,
    };
  }

  if (item?.lockedUntil && item.lockedUntil <= now) {
    LOGIN_ATTEMPTS.delete(key);
  }

  return { ok: true as const };
}

function recordFailedLogin(email: string) {
  const key = loginKey(email);
  const now = Date.now();
  const item = LOGIN_ATTEMPTS.get(key) || { count: 0, lockedUntil: 0 };
  const count = item.count + 1;

  if (count >= MAX_LOGIN_ATTEMPTS) {
    LOGIN_ATTEMPTS.set(key, { count, lockedUntil: now + LOCK_MS });
    return;
  }

  LOGIN_ATTEMPTS.set(key, { count, lockedUntil: 0 });
}

function clearFailedLogin(email: string) {
  LOGIN_ATTEMPTS.delete(loginKey(email));
}

function normEmail(s: string) {
  return s.trim().toLowerCase();
}

export async function handleLogin(req: Request) {
  try {
    await seedUserIfMissing();

    const body = (await req.json().catch(() => ({}))) as Body;

    const rawIdentifier = String(body.identifier || body.email || "").trim();
    const identifierType = rawIdentifier.includes("@") ? "email" : "phone";
    const email = normEmail(rawIdentifier);
    const password = String(body.password || "");

    if (!rawIdentifier) return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });
    if (!password) return NextResponse.json({ ok: false, error: "Weka password." }, { status: 400 });

    const limit = checkLoginLimit(rawIdentifier);
    if (!limit.ok) {
      return NextResponse.json(
        { ok: false, error: limit.error, retryAfter: limit.retryAfter },
        { status: 429 }
      );
    }

    const user = await findUserByIdentifier(identifierType, rawIdentifier);
    if (!user) {
      if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
        console.log("[KRISTO SIGNIN] account not found", {
          identifierType,
          rawIdentifier: identifierType === "email" ? email : rawIdentifier,
          normalizedEmail: identifierType === "email" ? email : undefined,
        });
      }
      recordFailedLogin(rawIdentifier);
      return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 404 });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      recordFailedLogin(rawIdentifier);
      return NextResponse.json({ ok: false, error: "Password is incorrect." }, { status: 401 });
    }

    clearFailedLogin(rawIdentifier);

    const sess = createSession(user.id);
    const kristoId = await ensureUserKristoId(user);

    let res = NextResponse.json({
      ok: true,
      userId: user.id,
      kristoId,
      publicKristoId: kristoId,
      email: user.email || "",
      phone: user.phone || "",
    });
    res = setSessionCookie(res, sess.id);
    return res;
  } catch (error: any) {
    const dbRes = authDatabaseErrorResponse(error);
    if (dbRes) return dbRes;
    const message = String(error?.message || error || "Sign in failed.");
    console.error("[KRISTO SIGNIN ERROR]", message);
    return NextResponse.json({ ok: false, error: message, reason: "signin_failed" }, { status: 500 });
  }
}
