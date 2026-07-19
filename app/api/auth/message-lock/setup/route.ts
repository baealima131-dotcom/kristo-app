import type { NextRequest } from "next/server";
import {
  auditMessageLockEvent,
  hashMessageLockPin,
  MESSAGE_LOCK_PIN_VERSION,
  publicStatusFromRecord,
  validateSetupBody,
} from "@/app/api/_lib/messageLock";
import {
  getMessageLockRecord,
  upsertMessageLockCredential,
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
    "message-lock-setup"
  );
  if (throttled) return throttled;

  const body = await req.json().catch(() => null);
  const validated = validateSetupBody(body);
  if (!validated.ok) {
    return json(
      { ok: false, error: validated.error, code: validated.code },
      { status: 400 }
    );
  }

  try {
    const existing = await getMessageLockRecord(authed.userId);
    if (existing?.enabled && existing.pinHash) {
      return json(
        {
          ok: false,
          error: "Message Lock is already enabled. Change or disable it first.",
          code: "already_enabled",
        },
        { status: 409 }
      );
    }

    const pinHash = hashMessageLockPin(validated.pin);
    const row = await upsertMessageLockCredential({
      userId: authed.userId,
      pinHash,
      pinLength: validated.pinLength,
      pinVersion: MESSAGE_LOCK_PIN_VERSION,
      timeoutSeconds: validated.timeoutSeconds,
      enabled: true,
    });

    auditMessageLockEvent("setup", authed.userId, {
      pinLength: validated.pinLength,
      timeoutSeconds: validated.timeoutSeconds,
    });

    return json({
      ok: true,
      data: publicStatusFromRecord(row),
    });
  } catch (e) {
    if (isStoreUnavailable(e)) return storeUnavailableResponse(authed.userId);
    throw e;
  }
}
