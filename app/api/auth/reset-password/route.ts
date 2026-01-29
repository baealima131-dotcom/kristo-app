import { NextResponse } from "next/server";
import {
  seedUserIfMissing,
  findUserByIdentifier,
  createChallenge,
  verifyChallenge,
  getUserById,
} from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

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
  seedUserIfMissing();

  const body = (await req.json().catch(() => ({}))) as Partial<Body>;
  const step = (body as any)?.step;

  if (step === "start") {
    const b = body as StartBody;
    const identifierType = b.identifierType;
    const identifier = String(b.identifier || "").trim();
    if (!identifier) return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });

    const user = findUserByIdentifier(identifierType, identifier);
    if (!user) return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 404 });

    const ch = createChallenge({ identifierType, identifier, userId: user.id });
    return NextResponse.json({ ok: true, challengeId: ch.id, devCode: ch.code });
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

    const u = getUserById(v.userId);
    if (!u) return NextResponse.json({ ok: false, error: "User haipo." }, { status: 404 });

    u.password = newPassword;
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Invalid step." }, { status: 400 });
}
