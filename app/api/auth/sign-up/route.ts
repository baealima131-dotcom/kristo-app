import { NextResponse } from "next/server";
import { createSession, createUser, seedUserIfMissing, setSessionCookie } from "@/app/api/auth/_lib/session";
import { ensureProfileDraft, type Gender } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

type Body = {
  email?: string;
  phone?: string;
  password?: string;

  firstName?: string;
  lastName?: string;
  fullName?: string;

  gender?: Gender;
  dob?: string; // YYYY-MM-DD

  country?: string;
  city?: string;
};

function norm(s: any) {
  return String(s ?? "").trim();
}
function normEmail(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export async function POST(req: Request) {
  seedUserIfMissing();

  const body = (await req.json().catch(() => ({}))) as Body;

  const email = normEmail(body.email);
  const phone = norm(body.phone);
  const password = norm(body.password);

  if (!email && !phone) return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });
  if (!password || password.length < 8) {
    return NextResponse.json({ ok: false, error: "Password iwe angalau characters 8." }, { status: 400 });
  }

  const r = createUser({ email: email || undefined, phone: phone || undefined, password });
  if (!r.ok) return NextResponse.json(r, { status: 400 });

  const userId = r.user.id;

  // Create session now (so /api/auth/me works immediately)
  const sess = createSession(userId);

  // Prefill profile draft (Sign-up data enters automatically)
  const fullName =
    norm(body.fullName) ||
    `${norm(body.firstName)} ${norm(body.lastName)}`.trim();

  ensureProfileDraft({
    userId,
    email: email || undefined,
    phone: phone || undefined,
    fullName,
    gender: body.gender === "FEMALE" ? "FEMALE" : body.gender === "MALE" ? "MALE" : undefined,
    dob: norm(body.dob) || undefined,
    country: norm(body.country) || undefined,
    city: norm(body.city) || undefined,
  });

  const res = NextResponse.json({
    ok: true,
    userId,
    coreId: userId, // MVP
    next: "/onboarding",
  });

  return setSessionCookie(res, sess.id);
}
