import { NextResponse } from "next/server";
import { verifyZporaChallenge } from "@/app/api/_lib/store/zporaIdentityDb";
import { getUserById, ensureUserKristoId, updateUserPersist } from "@/app/api/auth/_lib/session";
import { issueSessionToken } from "@/app/api/auth/_lib/sessionToken";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const challengeId = String(body.challengeId || "").trim();
    const code = String(body.code || "").trim();
    if (!challengeId || !/^\d{6}$/.test(code)) return NextResponse.json({ ok: false, error: "Enter the six-digit code from your email." }, { status: 400 });
    // Check signing configuration before consuming a one-use code.
    if (!issueSessionToken("zpora-verification-check")) return NextResponse.json({ ok: false, error: "Verification is temporarily unavailable." }, { status: 503 });
    const userId = await verifyZporaChallenge(challengeId, code);
    const user = await getUserById(userId);
    if (!user) throw new Error("Account not found. Please create an account again.");
    const kristoId = await ensureUserKristoId(user);
    await updateUserPersist(userId, { lastOtpAt: Date.now(), lastSeenAt: Date.now() });
    return NextResponse.json({ ok: true, userId, sessionToken: issueSessionToken(userId), kristoId,
      email: user.email, phone: user.phone, role: "Member", churchId: "" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Verification failed. Try again." }, { status: 400 });
  }
}
