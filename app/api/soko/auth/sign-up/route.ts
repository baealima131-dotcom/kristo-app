import { NextResponse } from "next/server";
import { createUser, rollbackSignupUser } from "@/app/api/auth/_lib/session";
import { ensureProfileDraft } from "@/app/api/auth/_lib/profile";
import { sendVerificationCodeEmail } from "@/app/api/_lib/email";
import { createZporaIdentity, deleteZporaIdentity, ensureZporaIdentitySchema } from "@/app/api/_lib/store/zporaIdentityDb";
import { publicSokoPolicyBundle } from "@/app/api/_lib/sokoLegalPolicy";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let userId = "";
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const fullName = String(body.fullName || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100 || password.length < 8 || password.length > 128) {
      return NextResponse.json({ ok: false, error: "Enter your name, a valid email, and a password of 8–128 characters." }, { status: 400 });
    }
    const current = publicSokoPolicyBundle().versions;
    if (body.agreedToTerms !== true || Object.keys(current).some(key => body.policyVersions?.[key] !== current[key as keyof typeof current])) {
      return NextResponse.json({ ok: false, error: "Read and agree to the current Zpora terms before creating an account." }, { status: 400 });
    }
    await ensureZporaIdentitySchema();
    const result = await createUser({ email, password });
    if (!result.ok) return NextResponse.json({ ok: false, error: "This email may already have an account. Sign in or recover your account." }, { status: 400 });
    userId = result.user.id;
    await ensureProfileDraft({ userId, email, fullName });
    const challenge = await createZporaIdentity(userId);
    const sent = await sendVerificationCodeEmail({ to: email, code: challenge.code, name: fullName });
    if (!sent.ok) throw new Error("Verification email could not be sent.");
    return NextResponse.json({ ok: true, challengeId: challenge.challengeId, needsVerification: true });
  } catch (error) {
    if (userId) {
      try { await rollbackSignupUser(userId); await deleteZporaIdentity(userId); }
      catch (cleanup) { console.error("ZPORA_SIGNUP_ROLLBACK_FAILED", String(cleanup)); }
    }
    console.error("ZPORA_SIGNUP_FAILED", String(error));
    return NextResponse.json({ ok: false, error: "Account creation could not finish. Please try again." }, { status: 503 });
  }
}
