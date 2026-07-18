/**
 * Centralized Safety account-enforcement error normalization + UI bus.
 *
 * Canonical backend codes (from app/api/_lib/rbac.ts):
 *   SAFETY_ACCOUNT_RESTRICTED
 *   SAFETY_ACCOUNT_SUSPENDED
 *   SAFETY_PERMANENT_BAN
 *
 * Call sites must NOT invent parallel Alert logic. Route errors through
 * notifySafetyAccountEnforcement() (wired from kristoApi httpError) and
 * render via SafetyAccountEnforcementGate.
 */

export type SafetyAccountEnforcementCode =
  | "SAFETY_ACCOUNT_RESTRICTED"
  | "SAFETY_ACCOUNT_SUSPENDED"
  | "SAFETY_PERMANENT_BAN";

export type SafetyAccountEnforcementState = {
  code: SafetyAccountEnforcementCode;
  message: string;
  expiresAt: string | null;
  receivedAt: number;
};

type Listener = (
  state: SafetyAccountEnforcementState | null
) => void;

const LISTENERS =
  new Set<Listener>();

let currentState:
  SafetyAccountEnforcementState | null = null;

const CANONICAL_CODES =
  new Set<string>([
    "SAFETY_ACCOUNT_RESTRICTED",
    "SAFETY_ACCOUNT_SUSPENDED",
    "SAFETY_PERMANENT_BAN",
    // Alias accepted for forward-compat with the
    // SAFETY_ACCOUNT_* naming family.
    "SAFETY_ACCOUNT_PERMANENT_BAN",
  ]);

function normalizeCode(
  raw: string
): SafetyAccountEnforcementCode | null {
  const code =
    String(raw || "")
      .trim()
      .toUpperCase();

  if (
    code ===
      "SAFETY_ACCOUNT_RESTRICTED"
  ) {
    return "SAFETY_ACCOUNT_RESTRICTED";
  }

  if (
    code ===
      "SAFETY_ACCOUNT_SUSPENDED"
  ) {
    return "SAFETY_ACCOUNT_SUSPENDED";
  }

  if (
    code ===
      "SAFETY_PERMANENT_BAN" ||
    code ===
      "SAFETY_ACCOUNT_PERMANENT_BAN"
  ) {
    return "SAFETY_PERMANENT_BAN";
  }

  return null;
}

function firstText(
  ...values: unknown[]
): string {
  for (const value of values) {
    const text =
      String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * Extract a canonical Safety enforcement signal from any API
 * error body / ApiErrorResult without changing unrelated shapes.
 */
export function normalizeSafetyAccountEnforcementError(
  body: any
): SafetyAccountEnforcementState | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const code = normalizeCode(
    firstText(
      body.code,
      body.details?.code,
      body.debug?.code
    )
  );

  if (!code) {
    return null;
  }

  const expiresAt =
    firstText(
      body.expiresAt,
      body.details?.expiresAt,
      body.debug?.expiresAt
    ) || null;

  const message =
    firstText(
      body.error,
      body.message
    ) ||
    (
      code ===
      "SAFETY_ACCOUNT_RESTRICTED"
        ? "Your account is temporarily restricted."
        : code ===
            "SAFETY_ACCOUNT_SUSPENDED"
          ? "This Kristo account is temporarily suspended."
          : "This Kristo account has been permanently banned."
    );

  return {
    code,
    message,
    expiresAt,
    receivedAt: Date.now(),
  };
}

export function isSafetyAccountEnforcementCode(
  value: unknown
): value is SafetyAccountEnforcementCode {
  return CANONICAL_CODES.has(
    String(value || "")
      .trim()
      .toUpperCase()
  );
}

export function getSafetyAccountEnforcementState() {
  return currentState;
}

export function subscribeSafetyAccountEnforcement(
  listener: Listener
) {
  LISTENERS.add(listener);
  listener(currentState);

  return () => {
    LISTENERS.delete(listener);
  };
}

function emit(
  state: SafetyAccountEnforcementState | null
) {
  currentState = state;
  for (const listener of LISTENERS) {
    try {
      listener(state);
    } catch {
      // Listener failures must never break API calls.
    }
  }
}

/**
 * Publish a Safety enforcement event for the global gate.
 * Restriction overwrites a prior restriction; suspend/ban always win.
 */
export function notifySafetyAccountEnforcement(
  body: any
): SafetyAccountEnforcementState | null {
  const next =
    normalizeSafetyAccountEnforcementError(
      body
    );

  if (!next) {
    return null;
  }

  if (
    currentState &&
    currentState.code !==
      "SAFETY_ACCOUNT_RESTRICTED" &&
    next.code ===
      "SAFETY_ACCOUNT_RESTRICTED"
  ) {
    // Do not downgrade an active suspend/ban overlay to a soft restriction.
    return currentState;
  }

  emit(next);
  return next;
}

export function clearSafetyAccountEnforcement() {
  emit(null);
}

export function formatSafetyExpiresAt(
  expiresAt: string | null | undefined
): string {
  const raw =
    String(expiresAt || "").trim();
  if (!raw) return "";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString();
}
