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
      await rollbackSignupUser(userId);
      const message = String(error?.message || error || "Verification email could not be sent.");
      console.error("[KRISTO SIGNUP EMAIL ERROR]", message);
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

    if (exposeEmailDebugDetails()) {
      console.log("[KRISTO SIGNUP EMAIL RESULT]", {
        email,
        ok: emailResult.ok,
        reason: emailResult.reason,
        error: emailResult.error,
        providerId: emailResult.providerId,
        skipped: emailResult.skipped,
        code: challenge.code,
      });
    }

    if (!emailResult.ok) {
      await rollbackSignupUser(userId);

      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json({
          ok: true,
          needsVerification: true,
          devMode: true,
          devCode: challenge.code,
          challengeId: challenge.id,
          userId,
          kristoId: r.user.kristoId,
          publicKristoId: r.user.kristoId,
          coreId: userId,
          next: "/verify-code",
          email: emailResult,
        });
      }

      return NextResponse.json(
        signupEmailFailurePayload(emailResult),
        { status: emailProviderFailureStatus(emailResult) }
      );
    }

    return NextResponse.json({
      ok: true,
      needsVerification: true,
      challengeId: challenge.id,
      userId,
      kristoId: r.user.kristoId,
      publicKristoId: r.user.kristoId,
      coreId: userId,
      next: "/verify-code",
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
