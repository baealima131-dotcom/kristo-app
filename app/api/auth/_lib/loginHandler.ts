import { NextResponse } from "next/server";
import {
  seedUserIfMissing,
  findUserByIdentifier,
  createSession,
  setSessionCookie,
} from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

type Body = { email?: string; password?: string };

function normEmail(s: string) {
  return s.trim().toLowerCase();
}

export async function handleLogin(req: Request) {
  seedUserIfMissing();

  const body = (await req.json().catch(() => ({}))) as Body;

  const email = normEmail(String(body.email || ""));
  const password = String(body.password || "");

  if (!email) return NextResponse.json({ ok: false, error: "Weka email." }, { status: 400 });
  if (!password) return NextResponse.json({ ok: false, error: "Weka password." }, { status: 400 });

  const user = findUserByIdentifier("email", email);
  if (!user) return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 404 });
  if (user.password !== password) return NextResponse.json({ ok: false, error: "Password si sahihi." }, { status: 401 });

  const sess = createSession(user.id);

  let res = NextResponse.json({ ok: true, userId: user.id });
  res = setSessionCookie(res, sess.id);
  return res;
}
