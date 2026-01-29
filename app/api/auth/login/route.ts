import { NextResponse } from "next/server";
import {
  seedUserIfMissing,
  findUserByIdentifier,
  createChallenge,
  resendChallenge,
  verifyChallenge,
  createSession,
  setSessionCookie,
  requiredAuthForUser,
  getUserById,
  touchUser,
} from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

type StartBody = {
  step: "start";
  identifierType: "email" | "phone";
  identifier: string;
  password: string;
};

type VerifyBody = {
  step: "verify";
  challengeId: string;
  code: string;
};

type ResendBody = {
  step: "resend";
  challengeId: string;
};

type Body = StartBody | VerifyBody | ResendBody;

function maskEmail(email: string) {
  const s = String(email || "");
  const [a, b] = s.split("@");
  if (!b) return s;
  const left = (a || "").slice(0, 2);
  return `${left}***@${b}`;
}

function maskPhone(phone: string) {
  const s = String(phone || "");
  if (s.length <= 4) return s;
  return s.slice(0, 2) + "******" + s.slice(-2);
}

export async function POST(req: Request) {
  seedUserIfMissing();

  const body = (await req.json().catch(() => ({}))) as Partial<Body>;
  const step = (body as any)?.step;

  if (step === "start") {
    const b = body as StartBody;
    const identifierType = b.identifierType;
    const identifier = String(b.identifier || "").trim();
    const password = String(b.password || "");

    if (!identifier) return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });
    if (!password) return NextResponse.json({ ok: false, error: "Weka password." }, { status: 400 });

    const user = findUserByIdentifier(identifierType, identifier);
    if (!user) return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 404 });
    if (user.password !== password) return NextResponse.json({ ok: false, error: "Password si sahihi." }, { status: 401 });

    const forceOtp = Boolean((b as any).forceOtp);

    const need = forceOtp ? "otp" : requiredAuthForUser(user);

    if (need === "password" || need === "none") {
      const sess = createSession(user.id);
      touchUser(user.id);
      let res = NextResponse.json({ ok: true, userId: user.id, mode: "password" });
      res = setSessionCookie(res, sess.id);
      return res;
    }

    const ch = createChallenge({ identifierType, identifier, userId: user.id });
    const sentTo = identifierType === "email" ? maskEmail(identifier) : maskPhone(identifier);

    return NextResponse.json({
      ok: true,
      mode: "otp",
      challengeId: ch.id,
      sentTo,
      devCode: ch.code, // DEMO
    });
  }

  if (step === "resend") {
    const b = body as ResendBody;
    const challengeId = String(b.challengeId || "").trim();
    if (!challengeId) return NextResponse.json({ ok: false, error: "Challenge haipo." }, { status: 400 });

    const r = resendChallenge(challengeId);
    if (!r.ok) return NextResponse.json(r, { status: (r as any).status || 429 });

    const ch = r.challenge;
    const sentTo = ch.identifierType === "email" ? maskEmail(ch.identifier) : maskPhone(ch.identifier);

    return NextResponse.json({
      ok: true,
      challengeId: ch.id,
      sentTo,
      devCode: ch.code, // DEMO
    });
  }

  if (step === "verify") {
    const b = body as VerifyBody;
    const challengeId = String(b.challengeId || "").trim();
    const code = String(b.code || "").trim();

    if (!challengeId) return NextResponse.json({ ok: false, error: "Challenge haipo." }, { status: 400 });
    if (!code) return NextResponse.json({ ok: false, error: "Weka verification code." }, { status: 400 });

    const v = verifyChallenge(challengeId, code);
    if (!v.ok) return NextResponse.json(v, { status: 400 });

    const user = getUserById(v.userId);
    if (user) {
      user.lastOtpAt = Date.now();
      touchUser(user.id);
    }

    const sess = createSession(v.userId);
    let res = NextResponse.json({ ok: true, userId: v.userId });
    res = setSessionCookie(res, sess.id);
    return res;
  }

  return NextResponse.json({ ok: false, error: "Invalid step." }, { status: 400 });
}
