import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByIdentifier } from "@/app/api/auth/_lib/session";
import { resendZporaChallenge } from "@/app/api/_lib/store/zporaIdentityDb";
import { sendVerificationCodeEmail } from "@/app/api/_lib/email";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const user = await findUserByIdentifier("email", String(body.email || "").trim().toLowerCase());
    if (!user || !bcrypt.compareSync(String(body.password || ""), user.password)) {
      return NextResponse.json({ ok: false, error: "Check your email and password." }, { status: 401 });
    }
    const challenge = await resendZporaChallenge(user.id);
    const sent = await sendVerificationCodeEmail({ to: String(user.email), code: challenge.code });
    if (!sent.ok) return NextResponse.json({ ok: false, error: "Email could not be sent. Wait 60 seconds and try again." }, { status: 503 });
    return NextResponse.json({ ok: true, challengeId: challenge.challengeId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not resend code." }, { status: 400 });
  }
}
