import { NextResponse } from "next/server";
import {
  getUserById,
  resendChallenge,
  seedUserIfMissing,
} from "@/app/api/auth/_lib/session";
import {
  emailProviderFailureStatus,
  isEmailProviderMissing,
  sendVerificationCodeEmail,
  signupEmailFailurePayload,
} from "@/app/api/_lib/email";

export const runtime = "nodejs";

type Body = { challengeId?: string };

function isServerSignupReviewBypass() {
  return (
    process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING === "1" ||
    process.env.KRISTO_APP_REVIEW_MODE === "1"
  );
}

function logSignupOtpDevOnly(scope: string, meta: { email?: string; userId?: string; challengeId?: string; code?: string }) {
  if (process.env.NODE_ENV === "production") return;
  console.log("[KRISTO_SIGNUP_DEV_OTP]", {
    scope,
    email: meta.email || null,
    userId: meta.userId || null,
    challengeId: meta.challengeId || null,
    code: meta.code || null,
  });
}

export async function POST(req: Request) {
  try {
    await seedUserIfMissing();

    const body = (await req.json().catch(() => ({}))) as Body;
    const challengeId = String(body?.challengeId || "").trim();
    if (!challengeId) {
      return NextResponse.json({ ok: false, error: "Challenge haipo." }, { status: 400 });
    }

    const resent = resendChallenge(challengeId);
    if (!resent.ok) {
      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
        scope: "resend",
        challengeId,
        error: resent.error,
        status: resent.status,
      });
      return NextResponse.json(
        { ok: false, error: resent.error },
        { status: resent.status || 429 }
      );
    }

    const ch = resent.challenge;
    if (ch.identifierType !== "email") {
      return NextResponse.json(
        { ok: false, error: "Email verification required for sign up." },
        { status: 400 }
      );
    }

    const user = await getUserById(ch.userId);
    const fullName = String(user?.email || ch.identifier || "").trim();

    let emailResult;
    try {
      emailResult = await sendVerificationCodeEmail({
        to: ch.identifier,
        code: ch.code,
        name: fullName,
      });
    } catch (error: any) {
      const message = String(error?.message || error || "Verification email could not be sent.");
      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
        scope: "resend",
        challengeId,
        email: ch.identifier,
        error: message,
      });
      return NextResponse.json(
        { ok: false, error: message, reason: "email_send_failed" },
        { status: 502 }
      );
    }

    const reviewBypass = isServerSignupReviewBypass();
    if (!emailResult.ok) {
      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
        scope: "resend",
        challengeId,
        email: ch.identifier,
        reason: emailResult.reason || (isEmailProviderMissing(emailResult) ? "email_not_configured" : "email_send_failed"),
        reviewBypass,
      });

      if (reviewBypass) {
        logSignupOtpDevOnly("resend-review-bypass", {
          email: ch.identifier,
          userId: ch.userId,
          challengeId: ch.id,
          code: ch.code,
        });
        console.log("KRISTO_SIGNUP_REVIEW_VERIFY_BYPASS", {
          scope: "resend",
          challengeId,
          email: ch.identifier,
          userId: ch.userId,
        });
        return NextResponse.json({
          ok: true,
          challengeId: ch.id,
          userId: ch.userId,
          reviewBypass: true,
        });
      }

      return NextResponse.json(
        signupEmailFailurePayload(emailResult),
        { status: emailProviderFailureStatus(emailResult) }
      );
    }

    logSignupOtpDevOnly("resend-sent", {
      email: ch.identifier,
      userId: ch.userId,
      challengeId: ch.id,
      code: ch.code,
    });

    console.log("KRISTO_SIGNUP_VERIFY_EMAIL_SENT", {
      scope: "resend",
      challengeId,
      email: ch.identifier,
      userId: ch.userId,
      providerId: emailResult.providerId || null,
    });

    return NextResponse.json({
      ok: true,
      challengeId: ch.id,
      userId: ch.userId,
      ...(reviewBypass ? { reviewBypass: true } : {}),
    });
  } catch (error: any) {
    const message = String(error?.message || error || "Resend failed.");
    console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
      scope: "resend",
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
