import { NextResponse } from "next/server";
import {
  createChallenge,
  createUser,
  rollbackSignupUser,
  seedUserIfMissing,
} from "@/app/api/auth/_lib/session";
import { ensureProfileDraft, type Gender } from "@/app/api/auth/_lib/profile";
import {
  emailProviderFailureStatus,
  exposeEmailDebugDetails,
  isEmailProviderMissing,
  sendVerificationCodeEmail,
  signupEmailFailurePayload,
} from "@/app/api/_lib/email";
import { authDatabaseErrorResponse } from "@/app/api/auth/_lib/authErrors";

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

function isServerSignupReviewBypass() {
  return (
    process.env.KRISTO_BYPASS_SUBSCRIPTION_FOR_TESTING === "1" ||
    process.env.KRISTO_APP_REVIEW_MODE === "1"
  );
}

function signupReviewBypassPayload(params: {
  challengeId: string;
  userId: string;
  kristoId?: string;
  challengeCode: string;
  emailFailed?: boolean;
}) {
  console.log("KRISTO_SIGNUP_REVIEW_VERIFY_BYPASS", {
    emailFailed: params.emailFailed === true,
    userId: params.userId,
    challengeId: params.challengeId,
  });
  return NextResponse.json({
    ok: true,
    needsVerification: true,
    reviewBypass: true,
    challengeId: params.challengeId,
    userId: params.userId,
    kristoId: params.kristoId,
    publicKristoId: params.kristoId,
    coreId: params.userId,
    reviewVerificationCode: params.challengeCode,
    next: "/verify-code",
  });
}

export async function POST(req: Request) {
  try {
    await seedUserIfMissing();

    const body = (await req.json().catch(() => ({}))) as Body;

    const email = normEmail(body.email);
    const phone = norm(body.phone);
    const password = norm(body.password);

    if (!email && !phone) {
      return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Password iwe angalau characters 8." },
        { status: 400 }
      );
    }

    const r = await createUser({ email: email || undefined, phone: phone || undefined, password });
    if (!r.ok) return NextResponse.json(r, { status: 400 });

    const userId = r.user.id;

    const fullName =
      norm(body.fullName) ||
      `${norm(body.firstName)} ${norm(body.lastName)}`.trim();

    await ensureProfileDraft({
      userId,
      email: email || undefined,
      phone: phone || undefined,
      fullName,
      gender: body.gender === "FEMALE" ? "FEMALE" : body.gender === "MALE" ? "MALE" : undefined,
      dob: norm(body.dob) || undefined,
      country: norm(body.country) || undefined,
      city: norm(body.city) || undefined,
    });

    if (!email) {
      await rollbackSignupUser(userId);
      return NextResponse.json(
        { ok: false, error: "Email verification is required for sign up." },
        { status: 400 }
      );
    }

    const challenge = createChallenge({
      identifierType: "email",
      identifier: email,
      userId,
    });

    let emailResult;
    try {
      emailResult = await sendVerificationCodeEmail({
        to: email,
        code: challenge.code,
        name: fullName,
      });
    } catch (error: any) {
      const message = String(error?.message || error || "Verification email could not be sent.");
      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
        email,
        userId,
        reason: "email_send_exception",
        error: message,
      });
      if (isServerSignupReviewBypass()) {
        return signupReviewBypassPayload({
          challengeId: challenge.id,
          userId,
          kristoId: r.user.kristoId,
          challengeCode: challenge.code,
          emailFailed: true,
        });
      }
      await rollbackSignupUser(userId);
      return NextResponse.json(
        {
          ok: false,
          error: message,
          reason: "email_send_failed",
          ...(exposeEmailDebugDetails() ? { debug: { exception: message } } : {}),
        },
        { status: 502 }
      );
    }

    const isProd = process.env.NODE_ENV === "production";
    const providerMissing = isEmailProviderMissing(emailResult);
    const reviewBypass = isServerSignupReviewBypass();

    if (!emailResult.ok) {
      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
        email,
        userId,
        reason: emailResult.reason || (providerMissing ? "email_not_configured" : "email_send_failed"),
        reviewBypass,
      });

      if (isProd) {
        if (reviewBypass) {
          return signupReviewBypassPayload({
            challengeId: challenge.id,
            userId,
            kristoId: r.user.kristoId,
            challengeCode: challenge.code,
            emailFailed: true,
          });
        }

        await rollbackSignupUser(userId);

        if (providerMissing) {
          return NextResponse.json(
            { ok: false, error: "Email service not configured.", reason: "email_not_configured" },
            { status: 503 }
          );
        }

        return NextResponse.json(
          signupEmailFailurePayload(emailResult),
          { status: emailProviderFailureStatus(emailResult) }
        );
      }

      if (providerMissing) {
        return NextResponse.json({
          ok: true,
          needsVerification: true,
          devOtp: challenge.code,
          challengeId: challenge.id,
          userId,
          kristoId: r.user.kristoId,
          publicKristoId: r.user.kristoId,
          coreId: userId,
          next: "/verify-code",
        });
      }

      await rollbackSignupUser(userId);
      return NextResponse.json(
        signupEmailFailurePayload(emailResult),
        { status: emailProviderFailureStatus(emailResult) }
      );
    }

    console.log("KRISTO_SIGNUP_VERIFY_EMAIL_SENT", {
      email,
      userId,
      providerId: emailResult.providerId || null,
      reviewBypass,
    });

    return NextResponse.json({
      ok: true,
      needsVerification: true,
      challengeId: challenge.id,
      userId,
      kristoId: r.user.kristoId,
      publicKristoId: r.user.kristoId,
      coreId: userId,
      next: "/verify-code",
      ...(reviewBypass && isProd ? { reviewBypass: true, reviewVerificationCode: challenge.code } : {}),
    });
  } catch (error: any) {
    const dbRes = authDatabaseErrorResponse(error);
    if (dbRes) return dbRes;
    const message = String(error?.message || error || "Sign up failed.");
    console.error("[KRISTO SIGNUP ERROR]", message);
    return NextResponse.json(
      {
        ok: false,
        error: exposeEmailDebugDetails() ? message : "Sign up failed. Please try again.",
        ...(exposeEmailDebugDetails() ? { debug: { exception: message } } : {}),
      },
      { status: 500 }
    );
  }
}
