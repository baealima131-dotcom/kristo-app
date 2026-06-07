import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createSession,
  ensureUserKristoId,
  getUserById,
  setSessionCookie,
  updateUserPersist,
  verifyChallenge,
} from "@/app/api/auth/_lib/session";
import { issueSessionToken } from "@/app/api/auth/_lib/sessionToken";

export const runtime = "nodejs";

function verifyStatus(reason?: string) {
  if (reason === "expired" || reason === "superseded") return 410;
  if (reason === "too_many_attempts") return 429;
  return 401;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const challengeId = String(body?.challengeId || "");
    const code = String(body?.code || "");

    if (!challengeId) {
      return NextResponse.json({ ok: false, error: "Challenge haipo." }, { status: 400 });
    }
    if (!code.trim()) {
      return NextResponse.json({ ok: false, error: "Weka verification code." }, { status: 400 });
    }

    const v = verifyChallenge(challengeId, code);
    if (!v.ok) {
      console.warn("[KRISTO VERIFY] challenge failed", {
        challengeId,
        reason: v.reason,
        error: v.error,
      });
      return NextResponse.json(
        { ok: false, error: v.error, reason: v.reason },
        { status: verifyStatus(v.reason) }
      );
    }

    const now = Date.now();
    await updateUserPersist(v.userId, { lastOtpAt: now, lastSeenAt: now });

    const user = await getUserById(v.userId);
    if (user) await ensureUserKristoId(user);

    const sess = createSession(v.userId);

    console.log("[KRISTO VERIFY] success", {
      userId: v.userId,
      sessionId: sess.id,
      kristoId: user?.kristoId,
    });

    const sessionToken = issueSessionToken(v.userId);
    console.log("KRISTO_SIGNIN_RESPONSE_TOKEN", {
      hasSessionToken: Boolean(String(sessionToken || "").trim()),
      scope: "login-verify-route",
    });
    if (!String(sessionToken || "").trim()) {
      return NextResponse.json(
        { ok: false, error: "Sign-in temporarily unavailable.", reason: "session_token_unavailable" },
        { status: 503 }
      );
    }

    const res = NextResponse.json({
      ok: true,
      sessionToken,
      session: {
        id: sess.id,
        userId: sess.userId,
        expiresAt: sess.expiresAt,
      },
      user: user
        ? {
            id: user.id,
            kristoId: user.kristoId,
            email: user.email,
            phone: user.phone,
          }
        : { id: v.userId },
      next: "/",
    });
    setSessionCookie(res, sess.id);
    return res;
  } catch (error: any) {
    const message = String(error?.message || error || "Verification failed.");
    console.error("[KRISTO VERIFY ERROR]", message, error?.stack || error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        reason: "verify_exception",
      },
      { status: 500 }
    );
  }
}
