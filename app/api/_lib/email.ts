import { Resend } from "resend";

export type EmailSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  providerId?: string;
  from?: string;
  debug?: Record<string, unknown>;
};

const resend = process.env.RESEND_API_KEY?.trim()
  ? new Resend(process.env.RESEND_API_KEY.trim())
  : null;

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function getResendFromAddress() {
  const configured = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (configured) return configured;
  return "Kristo <onboarding@resend.dev>";
}

export function exposeEmailDebugDetails() {
  return process.env.NODE_ENV !== "production" || process.env.KRISTO_DEBUG_EMAIL === "1";
}

function logEmailEvent(event: string, payload: Record<string, unknown>) {
  const safe = { ...payload };
  if (typeof safe.code === "string") {
    safe.code = exposeEmailDebugDetails() ? safe.code : "[redacted]";
  }
  console.log(`[KRISTO EMAIL] ${event}`, safe);
}

function normalizeResendResult(result: {
  data?: { id?: string | null } | null;
  error?: { message?: string; name?: string } | null;
}): EmailSendResult {
  if (result.error) {
    return {
      ok: false,
      error: String(result.error.message || "Email provider rejected the request."),
      reason: String(result.error.name || "resend_error"),
      debug: exposeEmailDebugDetails()
        ? { providerError: result.error }
        : undefined,
    };
  }

  const providerId = String(result.data?.id || "").trim();
  if (!providerId) {
    return {
      ok: false,
      error: "Email provider returned no message id.",
      reason: "missing_provider_id",
    };
  }

  return {
    ok: true,
    providerId,
    from: getResendFromAddress(),
  };
}

function missingKeyResult(): EmailSendResult {
  return {
    ok: false,
    skipped: true,
    reason: "Missing RESEND_API_KEY",
    error: "Email delivery is not configured on the server.",
  };
}

export async function sendVerificationCodeEmail(params: {
  to?: string | null;
  code: string;
  name?: string | null;
}): Promise<EmailSendResult> {
  const to = String(params.to || "").trim().toLowerCase();
  if (!to) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing recipient email",
      error: "Recipient email is required.",
    };
  }

  if (!resend) {
    logEmailEvent("verification_skipped", { to, reason: "Missing RESEND_API_KEY" });
    return missingKeyResult();
  }

  const from = getResendFromAddress();

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject: "Your Kristo App verification code",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2>Kristo App Verification</h2>
          <p>Hello ${params.name || "there"},</p>
          <p>Your verification code is:</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:6px">${params.code}</div>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
    });

    const normalized = normalizeResendResult(result);
    logEmailEvent(normalized.ok ? "verification_sent" : "verification_failed", {
      to,
      from,
      code: params.code,
      providerId: normalized.providerId,
      error: normalized.error,
      reason: normalized.reason,
    });
    return normalized;
  } catch (error: any) {
    const message = String(error?.message || error || "Failed to send verification email.");
    logEmailEvent("verification_exception", { to, from, error: message });
    return {
      ok: false,
      error: message,
      reason: "resend_exception",
      debug: exposeEmailDebugDetails() ? { exception: message } : undefined,
    };
  }
}

export async function sendPasswordResetEmail(params: {
  to?: string | null;
  code: string;
}): Promise<EmailSendResult> {
  const to = String(params.to || "").trim().toLowerCase();
  if (!to) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing recipient email",
      error: "Recipient email is required.",
    };
  }

  if (!resend) {
    logEmailEvent("reset_skipped", { to, reason: "Missing RESEND_API_KEY" });
    return missingKeyResult();
  }

  const from = getResendFromAddress();

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject: "Kristo password reset code",
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;line-height:1.5">
          <h2>Kristo password reset</h2>
          <p>Your Kristo verification code is:</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:6px">${params.code}</div>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
    });

    const normalized = normalizeResendResult(result);
    logEmailEvent(normalized.ok ? "reset_sent" : "reset_failed", {
      to,
      from,
      code: params.code,
      providerId: normalized.providerId,
      error: normalized.error,
      reason: normalized.reason,
    });
    return normalized;
  } catch (error: any) {
    const message = String(error?.message || error || "Failed to send password reset email.");
    logEmailEvent("reset_exception", { to, from, error: message });
    return {
      ok: false,
      error: message,
      reason: "resend_exception",
      debug: exposeEmailDebugDetails() ? { exception: message } : undefined,
    };
  }
}

export async function sendChurchInviteEmail(params: {
  to?: string | null;
  role: string;
  churchName?: string | null;
}): Promise<EmailSendResult> {
  const to = String(params.to || "").trim().toLowerCase();
  if (!to) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing recipient email",
      error: "Recipient email is required.",
    };
  }

  if (!resend) {
    return missingKeyResult();
  }

  const from = getResendFromAddress();

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject: "You have a Kristo App church invite",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2>Kristo App Invitation</h2>
          <p>You have been invited to join ${params.churchName || "a church"} as <strong>${params.role}</strong>.</p>
          <p>Open Kristo App and go to <strong>Me → Invitations</strong> to accept.</p>
        </div>
      `,
    });

    return normalizeResendResult(result);
  } catch (error: any) {
    return {
      ok: false,
      error: String(error?.message || error || "Failed to send invite email."),
      reason: "resend_exception",
    };
  }
}

export function emailFailureMessage(result: EmailSendResult) {
  return (
    result.error ||
    result.reason ||
    "Verification email could not be sent."
  );
}

export function emailFailurePayload(result: EmailSendResult) {
  const payload: Record<string, unknown> = {
    ok: false,
    error: emailFailureMessage(result),
    reason: result.reason,
  };

  if (exposeEmailDebugDetails()) {
    payload.debug = {
      skipped: result.skipped,
      from: getResendFromAddress(),
      configured: isResendConfigured(),
      providerError: result.error,
      details: result.debug,
    };
  }

  return payload;
}

export function signupEmailFailurePayload(result: EmailSendResult) {
  return {
    ...emailFailurePayload(result),
    reason: "email_send_failed",
  };
}

export function emailProviderFailureStatus(result: EmailSendResult) {
  if (result.skipped) return 503;
  return 502;
}
