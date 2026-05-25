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
    if (!identifier) return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });

    const limit = checkResetRequestLimit(identifierType, identifier);
    if (!limit.ok) {
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
    if (!user) return NextResponse.json({ ok: false, error: "This email does not exist." }, { status: 404 });

    const ch = createChallenge({ identifierType, identifier, userId: user.id });

    if (identifierType === "email") {
      const emailResult = await sendPasswordResetEmail({
        to: identifier,
        code: ch.code,
      });

      if (!emailResult.ok) {
        return NextResponse.json(emailFailurePayload(emailResult), { status: 500 });
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "Phone reset bado haijaunganishwa na SMS. Tumia email kwanza." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, challengeId: ch.id });
  }

  if (step === "verify") {
    const b = body as VerifyBody;
    const challengeId = String(b.challengeId || "").trim();
    const code = String(b.code || "").trim();
    const newPassword = String(b.newPassword || "");

    if (!challengeId) return NextResponse.json({ ok: false, error: "Challenge haipo." }, { status: 400 });
    if (!code) return NextResponse.json({ ok: false, error: "Weka verification code." }, { status: 400 });

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ ok: false, error: "Password mpya iwe angalau characters 8." }, { status: 400 });
    }

    const v = verifyChallenge(challengeId, code);
    if (!v.ok) return NextResponse.json(v, { status: 400 });

    const u = await getUserById(v.userId);
    if (!u) return NextResponse.json({ ok: false, error: "User haipo." }, { status: 404 });

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
