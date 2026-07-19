import type { MessageLockStatus } from "./messageLockTypes";

export type MessageLockVerifyFailure = {
  code?: string;
  reason?: string;
  message?: string;
  cooldownRemainingSec?: number;
  data?: MessageLockStatus;
};

/** User-facing verify errors — never include PIN digits. */
export function messageLockVerifyUserMessage(err: MessageLockVerifyFailure): string {
  const code = String(err?.code || "").trim();
  const reason = String(err?.reason || "").trim();
  if (code === "wrong_pin" || code === "locked") {
    return "Incorrect PIN. Try again.";
  }
  if (reason === "network_error" || code === "network_error") {
    return "Could not verify PIN. Check your connection and try again.";
  }
  const msg = String(err?.message || "").trim();
  if (/incorrect pin/i.test(msg)) {
    return "Incorrect PIN. Try again.";
  }
  if (msg) return msg;
  return "Could not verify PIN. Please try again.";
}

/** Pure UI reset after a failed verify (for gate + focused tests). */
export function messageLockVerifyFailureUi(err: MessageLockVerifyFailure): {
  pin: string;
  busy: boolean;
  unlocked: boolean;
  error: string;
  cooldown: number;
  status: MessageLockStatus | undefined;
  keypadDisabled: boolean;
} {
  const cooldown = Math.max(
    0,
    Number(err?.cooldownRemainingSec ?? err?.data?.cooldownRemainingSec ?? 0)
  );
  return {
    pin: "",
    busy: false,
    unlocked: false,
    error: messageLockVerifyUserMessage(err),
    cooldown,
    status: err?.data,
    keypadDisabled: cooldown > 0,
  };
}
