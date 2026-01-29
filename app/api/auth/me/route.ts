import { NextResponse } from "next/server";
import { getUserById, readSession, seedUserIfMissing, touchSession } from "@/app/api/auth/_lib/session";
import { ensureProfileDraft, getProfile } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

export async function GET() {
  seedUserIfMissing();

  const sess = await readSession();
  if (!sess) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  touchSession(sess.id);

  const u = getUserById(sess.userId);
  if (!u) return NextResponse.json({ ok: false, error: "User haipo." }, { status: 404 });

  // Ensure at least a draft exists so onboarding can prefill
  const p0 = getProfile(u.id) || ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone });

  return NextResponse.json({
    ok: true,
    viewer: { userId: u.id, email: u.email || "", phone: u.phone || "" },
    profile: p0,
  });
}
