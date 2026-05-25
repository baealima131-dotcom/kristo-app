import { NextResponse } from "next/server";
import { createChallenge, findUserByIdentifier, seedUserIfMissing } from "@/app/api/auth/_lib/session";
import {
  emailFailurePayload,
  exposeEmailDebugDetails,
  sendVerificationCodeEmail,
} from "@/app/api/_lib/email";

export const runtime = "nodejs";

function normEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  await seedUserIfMissing();

  try {
    const body = await req.json().catch(() => ({}));
    const email = normEmail(body?.email);

    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "Email required" }, { status: 400 });
    }

    const user = await findUserByIdentifier("email", email);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Account not found for this email." }, { status: 404 });
    }

    const challenge = createChallenge({
      identifierType: "email",
      identifier: email,
      userId: user.id,
    });

    const emailResult = await sendVerificationCodeEmail({
      to: email,
      code: challenge.code,
    });

    if (exposeEmailDebugDetails()) {
      console.log("[KRISTO SEND-CODE]", {
        email,
        challengeId: challenge.id,
        emailResult,
        code: challenge.code,
      });
    }

    if (!emailResult.ok) {
      return NextResponse.json(emailFailurePayload(emailResult), { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      challengeId: challenge.id,
      ...(exposeEmailDebugDetails()
        ? {
            devCode: challenge.code,
            providerId: emailResult.providerId,
            from: emailResult.from,
          }
        : {}),
    });
  } catch (error: any) {
    const message = String(error?.message || error || "Failed to send code");
    console.error("[KRISTO SEND-CODE ERROR]", message);
    return NextResponse.json(
      {
        ok: false,
        error: exposeEmailDebugDetails() ? message : "Failed to send code",
        ...(exposeEmailDebugDetails() ? { debug: { exception: message } } : {}),
      },
      { status: 500 }
    );
  }
}
