import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  seedUserIfMissing,
  findUserByIdentifier,
  createChallenge,
  verifyChallenge,
  getUserById,
  updateUserPersist,
} from "@/app/api/auth/_lib/session";
import { emailFailurePayload, sendPasswordResetEmail } from "@/app/api/_lib/email";

export const runtime = "nodejs";

const RESET_REQUESTS = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_LOCK_MS = 15 * 60 * 1000;
const MAX_RESET_REQUESTS = 3;

function resetKey(identifierType: string, identifier: string) {
  return `${identifierType}:${identifier.trim().toLowerCase()}`;
}

function checkResetRequestLimit(identifierType: string, identifier: string) {
  const key = resetKey(identifierType, identifier);
  const now = Date.now();
  const item = RESET_REQUESTS.get(key);

  if (item?.lockedUntil && item.lockedUntil > now) {
    return {
      ok: false as const,
      retryAfter: Math.ceil((item.lockedUntil - now) / 1000),
    };
  }

  if (!item || now - item.windowStart > RESET_WINDOW_MS) {
    RESET_REQUESTS.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return { ok: true as const };
  }

  const count = item.count + 1;

  if (count > MAX_RESET_REQUESTS) {
    RESET_REQUESTS.set(key, {
      count,
      windowStart: item.windowStart,
      lockedUntil: now + RESET_LOCK_MS,
    });

    return { ok: false as const, retryAfter: Math.ceil(RESET_LOCK_MS / 1000) };
  }

  RESET_REQUESTS.set(key, { ...item, count });
  return { ok: true as const };
}

type StartBody = {
  step: "start";
  identifierType: "email" | "phone";
  identifier: string;
};

type VerifyBody = {
  step: "verify";
  challengeId: string;
  code: string;
  newPassword: string;
};

type Body = StartBody | VerifyBody;

export async function POST(req: Request) {
  await seedUserIfMissing();

  const body = (await req.json().catch(() => ({}))) as Partial<Body>;
  const step = (body as any)?.step;

  if (step === "start") {
    const b = body as StartBody;
    const identifierType = b.identifierType;
    const identifier = String(b.identifier || "").trim();
    if (!identifier) {
      return NextResponse.json({ ok: false, error: "Enter your email or phone number." }, { status: 400 });
    }

    console.log("KRISTO_FORGOT_PASSWORD_REQUEST", {
      identifierType,
      hasAt: identifier.includes("@"),
    });

    if (identifierType === "phone") {
      console.log("KRISTO_FORGOT_PASSWORD_FAILED", { reason: "phone_not_supported" });
      return NextResponse.json(
        {
          ok: false,
          error: "Password reset by phone is not available. Please use your email address.",
        },
        { status: 400 }
      );
    }

    const limit = checkResetRequestLimit(identifierType, identifier);
    if (!limit.ok) {
      console.log("KRISTO_FORGOT_PASSWORD_FAILED", { reason: "rate_limited", retryAfter: limit.retryAfter });
      return NextResponse.json(
        {
          ok: false,
          error: "Too many reset requests. Please wait before requesting another code.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 }
      );
    }

    const user = await findUserByIdentifier(identifierType, identifier);
    if (!user) {
      console.log("KRISTO_FORGOT_PASSWORD_SENT", { delivered: false, reason: "no_matching_account" });
      return NextResponse.json({
        ok: true,
        message: "If an account exists with this email, we sent a reset code. Check your inbox.",
      });
    }

    const ch = createChallenge({ identifierType, identifier, userId: user.id });

    const emailResult = await sendPasswordResetEmail({
      to: identifier,
      code: ch.code,
    });

    if (!emailResult.ok) {
      console.log("KRISTO_FORGOT_PASSWORD_FAILED", {
        reason: emailResult.reason || "email_send_failed",
      });
      return NextResponse.json(emailFailurePayload(emailResult), { status: 500 });
    }

    console.log("KRISTO_FORGOT_PASSWORD_SENT", { delivered: true, challengeId: ch.id });
    return NextResponse.json({
      ok: true,
      challengeId: ch.id,
      message: "We sent a password reset code to your email.",
    });
  }

  if (step === "verify") {
    const b = body as VerifyBody;
    const challengeId = String(b.challengeId || "").trim();
    const code = String(b.code || "").trim();
    const newPassword = String(b.newPassword || "");

    if (!challengeId) {
      return NextResponse.json({ ok: false, error: "Reset session expired. Request a new code." }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ ok: false, error: "Enter the reset code from your email." }, { status: 400 });
    }

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json(
        { ok: false, error: "New password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const v = verifyChallenge(challengeId, code);
    if (!v.ok) return NextResponse.json(v, { status: 400 });

    const u = await getUserById(v.userId);
    if (!u) return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });

    const updated = await updateUserPersist(u.id, {
      password: bcrypt.hashSync(newPassword, 10),
      lastSeenAt: Date.now(),
      lastOtpAt: Date.now(),
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Password update failed." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Invalid step." }, { status: 400 });
}
