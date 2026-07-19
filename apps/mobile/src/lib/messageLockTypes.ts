export const MESSAGE_LOCK_PIN_LENGTHS = [4, 6, 8] as const;
export type MessageLockPinLength = (typeof MESSAGE_LOCK_PIN_LENGTHS)[number];

export const MESSAGE_LOCK_TIMEOUTS = [0, 60, 300, 900] as const;
export type MessageLockTimeoutSeconds = (typeof MESSAGE_LOCK_TIMEOUTS)[number];

export type MessageLockStatus = {
  enabled: boolean;
  hasPin: boolean;
  pinLength: MessageLockPinLength | null;
  timeoutSeconds: MessageLockTimeoutSeconds;
  locked: boolean;
  cooldownRemainingSec: number;
  failedAttempts: number;
};

export const DEFAULT_MESSAGE_LOCK_STATUS: MessageLockStatus = {
  enabled: false,
  hasPin: false,
  pinLength: null,
  timeoutSeconds: 0,
  locked: false,
  cooldownRemainingSec: 0,
  failedAttempts: 0,
};

export const TIMEOUT_OPTIONS: {
  value: MessageLockTimeoutSeconds;
  label: string;
}[] = [
  { value: 0, label: "Immediately" },
  { value: 60, label: "After 1 minute" },
  { value: 300, label: "After 5 minutes" },
  { value: 900, label: "After 15 minutes" },
];

export function isWeakMessageLockPin(pin: string): boolean {
  if (!/^\d+$/.test(pin) || pin.length < 4) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  const asc = "0123456789";
  const desc = "9876543210";
  return asc.includes(pin) || desc.includes(pin);
}

export function labelForMessageLockTimeout(
  seconds: MessageLockTimeoutSeconds
): string {
  return (
    TIMEOUT_OPTIONS.find((o) => o.value === seconds)?.label || "Immediately"
  );
}
