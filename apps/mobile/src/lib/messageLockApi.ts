import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  DEFAULT_MESSAGE_LOCK_STATUS,
  type MessageLockPinLength,
  type MessageLockStatus,
  type MessageLockTimeoutSeconds,
} from "@/src/lib/messageLockTypes";
import { messageLockVerifyUserMessage } from "@/src/lib/messageLockVerifyUi";

export {
  messageLockVerifyFailureUi,
  messageLockVerifyUserMessage,
  type MessageLockVerifyFailure,
} from "@/src/lib/messageLockVerifyUi";

function authHeaders() {
  return getKristoHeaders();
}

function normalizeStatus(raw: any): MessageLockStatus {
  const pinLength = [4, 6, 8].includes(Number(raw?.pinLength))
    ? (Number(raw.pinLength) as MessageLockPinLength)
    : null;
  const timeoutSeconds = [0, 60, 300, 900].includes(Number(raw?.timeoutSeconds))
    ? (Number(raw.timeoutSeconds) as MessageLockTimeoutSeconds)
    : 0;
  return {
    ...DEFAULT_MESSAGE_LOCK_STATUS,
    enabled: Boolean(raw?.enabled),
    hasPin: Boolean(raw?.hasPin),
    pinLength,
    timeoutSeconds,
    locked: Boolean(raw?.locked),
    cooldownRemainingSec: Math.max(0, Number(raw?.cooldownRemainingSec || 0)),
    failedAttempts: Math.max(0, Number(raw?.failedAttempts || 0)),
  };
}

function errMessage(res: any, fallback: string) {
  return String(res?.error || fallback);
}

export async function fetchMessageLockStatus(): Promise<MessageLockStatus> {
  const res: any = await apiGet("/api/auth/message-lock", {
    headers: authHeaders(),
  });
  if (!res?.ok || !res?.data) {
    throw new Error(errMessage(res, "Could not load Message Lock status."));
  }
  return normalizeStatus(res.data);
}

export async function setupMessageLock(args: {
  pin: string;
  confirmPin: string;
  pinLength: MessageLockPinLength;
  timeoutSeconds?: MessageLockTimeoutSeconds;
}): Promise<MessageLockStatus> {
  const res: any = await apiPost(
    "/api/auth/message-lock/setup",
    {
      pin: args.pin,
      confirmPin: args.confirmPin,
      pinLength: args.pinLength,
      ...(args.timeoutSeconds !== undefined
        ? { timeoutSeconds: args.timeoutSeconds }
        : {}),
    },
    { headers: authHeaders() }
  );
  if (!res?.ok || !res?.data) {
    throw Object.assign(new Error(errMessage(res, "Could not set up Message Lock.")), {
      code: res?.code,
      cooldownRemainingSec: res?.cooldownRemainingSec,
    });
  }
  return normalizeStatus(res.data);
}

export async function verifyMessageLockPin(pin: string): Promise<MessageLockStatus> {
  const res: any = await apiPost(
    "/api/auth/message-lock/verify",
    { pin },
    { headers: authHeaders() }
  );
  if (!res?.ok || !res?.data) {
    const code = String(res?.code || "").trim() || undefined;
    const reason = String(res?.reason || "").trim() || undefined;
    const data = res?.data ? normalizeStatus(res.data) : undefined;
    const cooldownRemainingSec = Math.max(
      0,
      Number(res?.cooldownRemainingSec ?? data?.cooldownRemainingSec ?? 0)
    );
    const message = messageLockVerifyUserMessage({
      code,
      reason,
      message: errMessage(res, ""),
      cooldownRemainingSec,
      data,
    });
    throw Object.assign(new Error(message), {
      code,
      reason,
      cooldownRemainingSec,
      data,
    });
  }
  return normalizeStatus(res.data);
}

export async function changeMessageLockPin(args: {
  currentPin: string;
  pin: string;
  confirmPin: string;
  pinLength: MessageLockPinLength;
}): Promise<MessageLockStatus> {
  const res: any = await apiPost(
    "/api/auth/message-lock/change",
    args,
    { headers: authHeaders() }
  );
  if (!res?.ok || !res?.data) {
    throw Object.assign(new Error(errMessage(res, "Could not change PIN.")), {
      code: res?.code,
      cooldownRemainingSec: res?.cooldownRemainingSec,
    });
  }
  return normalizeStatus(res.data);
}

export async function disableMessageLock(
  currentPin: string
): Promise<MessageLockStatus> {
  const res: any = await apiPost(
    "/api/auth/message-lock/disable",
    { currentPin },
    { headers: authHeaders() }
  );
  if (!res?.ok || !res?.data) {
    throw Object.assign(new Error(errMessage(res, "Could not disable Message Lock.")), {
      code: res?.code,
      cooldownRemainingSec: res?.cooldownRemainingSec,
    });
  }
  return normalizeStatus(res.data);
}

export async function patchMessageLockTimeout(args: {
  currentPin: string;
  timeoutSeconds: MessageLockTimeoutSeconds;
}): Promise<MessageLockStatus> {
  const res: any = await apiPatch(
    "/api/auth/message-lock",
    args,
    { headers: authHeaders() }
  );
  if (!res?.ok || !res?.data) {
    throw Object.assign(new Error(errMessage(res, "Could not update timeout.")), {
      code: res?.code,
      cooldownRemainingSec: res?.cooldownRemainingSec,
    });
  }
  return normalizeStatus(res.data);
}
