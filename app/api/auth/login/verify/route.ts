import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSession, setSessionCookie, verifyChallenge } from "@/app/api/auth/_lib/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const challengeId = String(body?.challengeId || "");
  const code = String(body?.code || "");

  if (!challengeId) return NextResponse.json({ ok: false, error: "Challenge haipo." }, { status: 400 });
  if (!code.trim()) return NextResponse.json({ ok: false, error: "Weka verification code." }, { status: 400 });

  const v = verifyChallenge(challengeId, code);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 401 });

  const sess = createSession(v.userId);
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, sess.id);
  return res;
}
