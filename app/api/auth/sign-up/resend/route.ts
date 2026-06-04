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
        reason: emailResult.reason || null,
        reviewBypass,
      });

      if (reviewBypass) {
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
          reviewVerificationCode: ch.code,
        });
      }

      return NextResponse.json(
        signupEmailFailurePayload(emailResult),
        { status: emailProviderFailureStatus(emailResult) }
      );
    }

    console.log("KRISTO_SIGNUP_VERIFY_EMAIL_SENT", {
      scope: "resend",
      challengeId,
      email: ch.identifier,
      userId: ch.userId,
      providerId: emailResult.providerId || null,
    });

    const isProd = process.env.NODE_ENV === "production";
    return NextResponse.json({
      ok: true,
      challengeId: ch.id,
      userId: ch.userId,
      ...(!isProd ? { devOtp: ch.code } : {}),
      ...(reviewBypass && isProd ? { reviewBypass: true, reviewVerificationCode: ch.code } : {}),
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
