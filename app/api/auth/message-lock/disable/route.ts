import type { NextRequest } from "next/server";
import {
  auditMessageLockEvent,
  cooldownMsForFailedAttempts,
  cooldownRemainingSec,
  publicStatusFromRecord,
  validateDisableBody,
  verifyMessageLockPin,
} from "@/app/api/_lib/messageLock";
import {
  clearMessageLockCredential,
  getMessageLockRecord,
  recordMessageLockFailure,
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
    "message-lock-disable"
  );
  if (throttled) return throttled;

  const body = await req.json().catch(() => null);
  const validated = validateDisableBody(body);
  if (!validated.ok) {
    return json(
      { ok: false, error: validated.error, code: validated.code },
      { status: 400 }
    );
  }

  try {
    const row = await getMessageLockRecord(authed.userId);
    if (!row || !row.enabled || !row.pinHash) {
      return json({
        ok: true,
        data: publicStatusFromRecord(null),
      });
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
        context: "disable",
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

    await clearMessageLockCredential(authed.userId);
    auditMessageLockEvent("disable", authed.userId);

    return json({
      ok: true,
      data: publicStatusFromRecord(null),
    });
  } catch (e) {
    if (isStoreUnavailable(e)) return storeUnavailableResponse(authed.userId);
    throw e;
  }
}
