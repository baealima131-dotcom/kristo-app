/**
 * Kristo Message Lock — in-app PIN (user-scoped app privacy, not encryption).
 * Hashing: bcryptjs cost 12. Never log or return raw PIN / hash.
 */

import bcrypt from "bcryptjs";

export const MESSAGE_LOCK_PIN_VERSION = 1;
export const MESSAGE_LOCK_BCRYPT_COST = 12;
export const MESSAGE_LOCK_PIN_LENGTHS = [4, 6, 8] as const;
export type MessageLockPinLength = (typeof MESSAGE_LOCK_PIN_LENGTHS)[number];

export const MESSAGE_LOCK_TIMEOUTS = [0, 60, 300, 900] as const;
export type MessageLockTimeoutSeconds = (typeof MESSAGE_LOCK_TIMEOUTS)[number];

export type MessageLockRecord = {
  userId: string;
  pinVersion: number;
  pinLength: MessageLockPinLength;
  pinHash: string;
  enabled: boolean;
  timeoutSeconds: MessageLockTimeoutSeconds;
  failedAttempts: number;
  cooldownUntil: number | null;
  credentialUpdatedAt: number;
  updatedAt: number;
};

export type MessageLockPublicStatus = {
  enabled: boolean;
  hasPin: boolean;
  pinLength: MessageLockPinLength | null;
  timeoutSeconds: MessageLockTimeoutSeconds;
  locked: boolean;
  cooldownRemainingSec: number;
  failedAttempts: number;
};

export type MessageLockValidationError = {
  ok: false;
  error: string;
  code:
    | "invalid_body"
    | "unknown_keys"
    | "invalid_length"
    | "non_digits"
    | "mismatch"
    | "weak_pin"
    | "invalid_timeout"
    | "missing_pin"
    | "missing_current_pin";
};

const WEAK_REASON =
  "Choose a stronger PIN. Avoid repeated digits or simple sequences.";

export function isMessageLockPinLength(
  value: unknown
): value is MessageLockPinLength {
  return (
    typeof value === "number" &&
    (MESSAGE_LOCK_PIN_LENGTHS as readonly number[]).includes(value)
  );
}

export function isMessageLockTimeout(
  value: unknown
): value is MessageLockTimeoutSeconds {
  return (
    typeof value === "number" &&
    (MESSAGE_LOCK_TIMEOUTS as readonly number[]).includes(value)
  );
}

export function isDigitsOnlyPin(pin: string): boolean {
  return /^\d+$/.test(pin);
}

export function isWeakPin(pin: string): boolean {
  if (!pin || !isDigitsOnlyPin(pin)) return true;
  if (pin.length < 4) return true;

  // Repeated single digit: 0000, 111111, …
  if (/^(\d)\1+$/.test(pin)) return true;

  // Full-length ascending / descending sequences
  const asc = "0123456789";
  const desc = "9876543210";
  if (asc.includes(pin) || desc.includes(pin)) return true;

  return false;
}

export function hashMessageLockPin(pin: string): string {
  return bcrypt.hashSync(pin, MESSAGE_LOCK_BCRYPT_COST);
}

export function verifyMessageLockPin(pin: string, pinHash: string): boolean {
  if (!pin || !pinHash) return false;
  try {
    return bcrypt.compareSync(pin, pinHash);
  } catch {
    return false;
  }
}

/** Escalating cooldown after repeated failures (shared across devices). */
export function cooldownMsForFailedAttempts(failedAttempts: number): number {
  const n = Math.max(0, Math.floor(failedAttempts));
  if (n < 5) return 0;
  if (n === 5) return 30_000;
  if (n <= 7) return 120_000;
  if (n <= 9) return 300_000;
  return 900_000;
}

export function cooldownRemainingSec(
  cooldownUntil: number | null | undefined,
  now = Date.now()
): number {
  const until = Number(cooldownUntil || 0);
  if (!until || until <= now) return 0;
  return Math.ceil((until - now) / 1000);
}

export function publicStatusFromRecord(
  row: MessageLockRecord | null,
  now = Date.now()
): MessageLockPublicStatus {
  if (!row || !row.enabled || !row.pinHash) {
    return {
      enabled: false,
      hasPin: false,
      pinLength: null,
      timeoutSeconds: row?.timeoutSeconds ?? 0,
      locked: false,
      cooldownRemainingSec: 0,
      failedAttempts: 0,
    };
  }
  const remaining = cooldownRemainingSec(row.cooldownUntil, now);
  return {
    enabled: true,
    hasPin: true,
    pinLength: row.pinLength,
    timeoutSeconds: row.timeoutSeconds,
    locked: remaining > 0,
    cooldownRemainingSec: remaining,
    failedAttempts: Math.max(0, row.failedAttempts || 0),
  };
}

function reject(
  code: MessageLockValidationError["code"],
  error: string
): MessageLockValidationError {
  return { ok: false, code, error };
}

const FORBIDDEN_BODY_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertObjectBody(
  body: unknown
): { ok: true; obj: Record<string, unknown> } | MessageLockValidationError {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject("invalid_body", "Invalid request body.");
  }
  const proto = Object.getPrototypeOf(body);
  // Reject prototype-polluted objects; allow plain Object or null-prototype maps.
  if (proto !== Object.prototype && proto !== null) {
    return reject("invalid_body", "Invalid request body.");
  }
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return reject("unknown_keys", "Invalid request fields.");
    }
  }
  return { ok: true, obj: body as Record<string, unknown> };
}

function assertAllowedKeys(
  obj: Record<string, unknown>,
  allowed: string[]
): MessageLockValidationError | null {
  const keys = Object.getOwnPropertyNames(obj);
  const unknown = keys.filter(
    (k) => FORBIDDEN_BODY_KEYS.has(k) || !allowed.includes(k)
  );
  if (unknown.length) {
    return reject("unknown_keys", "Invalid request fields.");
  }
  return null;
}

function parsePinField(
  value: unknown,
  field: "pin" | "confirmPin" | "currentPin"
): { ok: true; pin: string } | MessageLockValidationError {
  if (value === undefined || value === null) {
    return reject(
      field === "currentPin" ? "missing_current_pin" : "missing_pin",
      field === "currentPin" ? "Current PIN is required." : "PIN is required."
    );
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return reject("non_digits", "PIN must be digits only.");
  }
  const pin = String(value);
  if (!isDigitsOnlyPin(pin)) {
    return reject("non_digits", "PIN must be digits only.");
  }
  if (!isMessageLockPinLength(pin.length)) {
    return reject("invalid_length", "PIN must be 4, 6, or 8 digits.");
  }
  return { ok: true, pin };
}

export function validateSetupBody(body: unknown):
  | {
      ok: true;
      pin: string;
      pinLength: MessageLockPinLength;
      timeoutSeconds: MessageLockTimeoutSeconds;
    }
  | MessageLockValidationError {
  const parsed = assertObjectBody(body);
  if (!parsed.ok) return parsed;
  const badKeys = assertAllowedKeys(parsed.obj, [
    "pin",
    "confirmPin",
    "pinLength",
    "timeoutSeconds",
  ]);
  if (badKeys) return badKeys;

  const pinLengthRaw = parsed.obj.pinLength;
  if (!isMessageLockPinLength(pinLengthRaw)) {
    return reject("invalid_length", "PIN length must be 4, 6, or 8.");
  }

  const pinRes = parsePinField(parsed.obj.pin, "pin");
  if (!pinRes.ok) return pinRes;
  const confirmRes = parsePinField(parsed.obj.confirmPin, "confirmPin");
  if (!confirmRes.ok) return confirmRes;

  if (pinRes.pin.length !== pinLengthRaw) {
    return reject("invalid_length", "PIN must match the selected length.");
  }
  if (confirmRes.pin.length !== pinLengthRaw) {
    return reject("invalid_length", "Confirmation PIN must match the selected length.");
  }
  if (pinRes.pin !== confirmRes.pin) {
    return reject("mismatch", "PIN confirmation does not match.");
  }
  if (isWeakPin(pinRes.pin)) {
    return reject("weak_pin", WEAK_REASON);
  }

  let timeoutSeconds: MessageLockTimeoutSeconds = 0;
  if (parsed.obj.timeoutSeconds !== undefined) {
    if (!isMessageLockTimeout(parsed.obj.timeoutSeconds)) {
      return reject("invalid_timeout", "Invalid lock timeout.");
    }
    timeoutSeconds = parsed.obj.timeoutSeconds;
  }

  return {
    ok: true,
    pin: pinRes.pin,
    pinLength: pinLengthRaw,
    timeoutSeconds,
  };
}

export function validateVerifyBody(body: unknown):
  | { ok: true; pin: string }
  | MessageLockValidationError {
  const parsed = assertObjectBody(body);
  if (!parsed.ok) return parsed;
  const badKeys = assertAllowedKeys(parsed.obj, ["pin"]);
  if (badKeys) return badKeys;
  const pinRes = parsePinField(parsed.obj.pin, "pin");
  if (!pinRes.ok) return pinRes;
  return { ok: true, pin: pinRes.pin };
}

export function validateChangeBody(body: unknown):
  | {
      ok: true;
      currentPin: string;
      pin: string;
      pinLength: MessageLockPinLength;
    }
  | MessageLockValidationError {
  const parsed = assertObjectBody(body);
  if (!parsed.ok) return parsed;
  const badKeys = assertAllowedKeys(parsed.obj, [
    "currentPin",
    "pin",
    "confirmPin",
    "pinLength",
  ]);
  if (badKeys) return badKeys;

  const currentRes = parsePinField(parsed.obj.currentPin, "currentPin");
  if (!currentRes.ok) return currentRes;

  const pinLengthRaw = parsed.obj.pinLength;
  if (!isMessageLockPinLength(pinLengthRaw)) {
    return reject("invalid_length", "PIN length must be 4, 6, or 8.");
  }

  const pinRes = parsePinField(parsed.obj.pin, "pin");
  if (!pinRes.ok) return pinRes;
  const confirmRes = parsePinField(parsed.obj.confirmPin, "confirmPin");
  if (!confirmRes.ok) return confirmRes;

  if (pinRes.pin.length !== pinLengthRaw || confirmRes.pin.length !== pinLengthRaw) {
    return reject("invalid_length", "PIN must match the selected length.");
  }
  if (pinRes.pin !== confirmRes.pin) {
    return reject("mismatch", "PIN confirmation does not match.");
  }
  if (isWeakPin(pinRes.pin)) {
    return reject("weak_pin", WEAK_REASON);
  }

  return {
    ok: true,
    currentPin: currentRes.pin,
    pin: pinRes.pin,
    pinLength: pinLengthRaw,
  };
}

export function validateDisableBody(body: unknown):
  | { ok: true; currentPin: string }
  | MessageLockValidationError {
  const parsed = assertObjectBody(body);
  if (!parsed.ok) return parsed;
  const badKeys = assertAllowedKeys(parsed.obj, ["currentPin"]);
  if (badKeys) return badKeys;
  const currentRes = parsePinField(parsed.obj.currentPin, "currentPin");
  if (!currentRes.ok) return currentRes;
  return { ok: true, currentPin: currentRes.pin };
}

export function validateTimeoutPatchBody(body: unknown):
  | {
      ok: true;
      currentPin: string;
      timeoutSeconds: MessageLockTimeoutSeconds;
    }
  | MessageLockValidationError {
  const parsed = assertObjectBody(body);
  if (!parsed.ok) return parsed;
  const badKeys = assertAllowedKeys(parsed.obj, ["currentPin", "timeoutSeconds"]);
  if (badKeys) return badKeys;
  const currentRes = parsePinField(parsed.obj.currentPin, "currentPin");
  if (!currentRes.ok) return currentRes;
  if (!isMessageLockTimeout(parsed.obj.timeoutSeconds)) {
    return reject("invalid_timeout", "Invalid lock timeout.");
  }
  return {
    ok: true,
    currentPin: currentRes.pin,
    timeoutSeconds: parsed.obj.timeoutSeconds,
  };
}

/** Safe audit — never include PIN or hash. */
export function auditMessageLockEvent(
  event:
    | "setup"
    | "verify_ok"
    | "verify_fail"
    | "cooldown"
    | "change"
    | "disable"
    | "timeout_patch"
    | "store_unavailable",
  userId: string,
  extra?: Record<string, string | number | boolean | null>
) {
  try {
    console.log(
      JSON.stringify({
        type: "KRISTO_MESSAGE_LOCK",
        event,
        userId: String(userId || "").trim() || null,
        at: Date.now(),
        ...(extra || {}),
      })
    );
  } catch {
    // ignore
  }
}
