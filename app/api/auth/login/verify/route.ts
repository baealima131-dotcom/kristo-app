import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getActiveMembership } from "@/app/api/_lib/memberships";
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
    const activeMembership = await getActiveMembership(v.userId);
    const churchId = String(activeMembership?.churchId || "").trim();
    const churchRole = String(activeMembership?.churchRole || "").trim();
    const role = churchRole || "Member";
    const sessionToken = issueSessionToken(v.userId);

    if (!sessionToken) {
      console.error("KRISTO_VERIFY_TOKEN_ISSUE_FAILED", { userId: v.userId });
      return NextResponse.json(
        {
          ok: false,
          error: "Verification session could not be created. Please try again.",
          reason: "session_token_unavailable",
        },
        { status: 503 }
      );
    }

    console.log("[KRISTO VERIFY] success", {
      userId: v.userId,
      sessionId: sess.id,
      kristoId: user?.kristoId,
      hasSessionToken: true,
    });

    const res = NextResponse.json({
      ok: true,
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
      userId: v.userId,
      sessionToken,
      role,
      churchId,
      churchRole: churchRole || role,
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
