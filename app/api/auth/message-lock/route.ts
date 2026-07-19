import type { NextRequest } from "next/server";
import {
  auditMessageLockEvent,
  cooldownMsForFailedAttempts,
  cooldownRemainingSec,
  publicStatusFromRecord,
  validateTimeoutPatchBody,
  verifyMessageLockPin,
} from "@/app/api/_lib/messageLock";
import {
  getMessageLockRecord,
  recordMessageLockFailure,
  updateMessageLockTimeout,
} from "@/app/api/_lib/store/messageLockDb";
import {
  enforceMessageLockIpThrottle,
  isStoreUnavailable,
  json,
  requireMessageLockUser,
  storeUnavailableResponse,
} from "./_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authed = await requireMessageLockUser(req);
  if (authed instanceof Response) return authed;

  try {
    const row = await getMessageLockRecord(authed.userId);
    return json({
      ok: true,
      data: publicStatusFromRecord(row),
    });
  } catch (e) {
    if (isStoreUnavailable(e)) return storeUnavailableResponse(authed.userId);
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  const authed = await requireMessageLockUser(req);
  if (authed instanceof Response) return authed;

  const throttled = await enforceMessageLockIpThrottle(
    req,
    "message-lock-patch"
  );
  if (throttled) return throttled;

  const body = await req.json().catch(() => null);
  const validated = validateTimeoutPatchBody(body);
  if (!validated.ok) {
    return json(
      { ok: false, error: validated.error, code: validated.code },
      { status: 400 }
    );
  }

  try {
    const row = await getMessageLockRecord(authed.userId);
    if (!row || !row.enabled || !row.pinHash) {
      return json(
        { ok: false, error: "Message Lock is not enabled.", code: "not_enabled" },
        { status: 400 }
      );
    }

    const remaining = cooldownRemainingSec(row.cooldownUntil);
    if (remaining > 0) {
      auditMessageLockEvent("cooldown", authed.userId, { remaining });
      return json(
        {
          ok: false,
          error: "Too many failed attempts. Please wait before trying again.",
          code: "cooldown",
          cooldownRemainingSec: remaining,
        },
        { status: 429 }
      );
    }

    if (!verifyMessageLockPin(validated.currentPin, row.pinHash)) {
      const failedAttempts = (row.failedAttempts || 0) + 1;
      const coolMs = cooldownMsForFailedAttempts(failedAttempts);
      const cooldownUntil = coolMs > 0 ? Date.now() + coolMs : null;
      const next = await recordMessageLockFailure({
        userId: authed.userId,
        failedAttempts,
        cooldownUntil,
      });
      auditMessageLockEvent("verify_fail", authed.userId, {
        failedAttempts,
        context: "timeout_patch",
      });
      return json(
        {
          ok: false,
          error: "Current PIN is incorrect.",
          code: "wrong_pin",
          cooldownRemainingSec: cooldownRemainingSec(next?.cooldownUntil),
        },
        { status: 401 }
      );
    }

    const next = await updateMessageLockTimeout({
      userId: authed.userId,
      timeoutSeconds: validated.timeoutSeconds,
    });
    auditMessageLockEvent("timeout_patch", authed.userId, {
      timeoutSeconds: validated.timeoutSeconds,
    });

    return json({
      ok: true,
      data: publicStatusFromRecord(next),
    });
  } catch (e) {
    if (isStoreUnavailable(e)) return storeUnavailableResponse(authed.userId);
    const message = e instanceof Error ? e.message : "Could not update timeout.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
