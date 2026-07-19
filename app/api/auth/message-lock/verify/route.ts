import type { NextRequest } from "next/server";
import {
  auditMessageLockEvent,
  cooldownMsForFailedAttempts,
  cooldownRemainingSec,
  publicStatusFromRecord,
  validateVerifyBody,
  verifyMessageLockPin,
} from "@/app/api/_lib/messageLock";
import {
  getMessageLockRecord,
  recordMessageLockFailure,
  resetMessageLockFailures,
} from "@/app/api/_lib/store/messageLockDb";
import {
  enforceMessageLockIpThrottle,
  isStoreUnavailable,
  json,
  requireMessageLockUser,
  storeUnavailableResponse,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authed = await requireMessageLockUser(req);
  if (authed instanceof Response) return authed;

  const throttled = await enforceMessageLockIpThrottle(
    req,
    "message-lock-verify"
  );
  if (throttled) return throttled;

  const body = await req.json().catch(() => null);
  const validated = validateVerifyBody(body);
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
        {
          ok: false,
          error: "Message Lock is not enabled.",
          code: "not_enabled",
        },
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
          data: publicStatusFromRecord(row),
        },
        { status: 429 }
      );
    }

    if (!verifyMessageLockPin(validated.pin, row.pinHash)) {
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
        cooldownSec: coolMs > 0 ? Math.ceil(coolMs / 1000) : 0,
      });
      return json(
        {
          ok: false,
          error: "Incorrect PIN.",
          code: "wrong_pin",
          cooldownRemainingSec: cooldownRemainingSec(next?.cooldownUntil),
          data: publicStatusFromRecord(next),
        },
        { status: 401 }
      );
    }

    const next = await resetMessageLockFailures(authed.userId);
    auditMessageLockEvent("verify_ok", authed.userId);
    return json({
      ok: true,
      data: publicStatusFromRecord(next || row),
    });
  } catch (e) {
    if (isStoreUnavailable(e)) return storeUnavailableResponse(authed.userId);
    throw e;
  }
}
