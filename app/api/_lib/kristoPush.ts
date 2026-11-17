import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import { notifyKristoApnsVoipCall } from "@/app/api/_lib/kristoApnsVoip";
import { deletePushDevice, pushTokensForUser } from "@/app/api/_lib/store/pushDevicesDb";
import type { PrivateCallSession } from "@/app/api/_lib/privateCallSessions";

/**
 * Kristo push through FCM HTTP v1. Disabled unless a Firebase service account is configured
 * (KRISTO_FCM_SERVICE_ACCOUNT_JSON or KRISTO_FCM_SERVICE_ACCOUNT_FILE); without one every send is
 * a logged no-op.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let accountPromise: Promise<ServiceAccount | null> | null = null;
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function loadServiceAccount(): Promise<ServiceAccount | null> {
  if (!accountPromise) {
    accountPromise = (async () => {
      // Vercel: the JSON itself (raw or base64) in KRISTO_FCM_SERVICE_ACCOUNT_JSON.
      // Local testing: a path in KRISTO_FCM_SERVICE_ACCOUNT_FILE.
      const inline = String(process.env.KRISTO_FCM_SERVICE_ACCOUNT_JSON || "").trim();
      const file = String(process.env.KRISTO_FCM_SERVICE_ACCOUNT_FILE || "").trim();
      if (!inline && !file) return null;
      try {
        const raw = inline
          ? inline.startsWith("{")
            ? inline
            : Buffer.from(inline, "base64").toString("utf8")
          : await readFile(file, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) return null;
        return parsed as ServiceAccount;
      } catch (error) {
        console.log("KRISTO_PUSH_SERVICE_ACCOUNT_UNREADABLE", { error: String((error as Error)?.message || error) });
        return null;
      }
    })();
  }
  return accountPromise;
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${base64Url(signature)}`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw new Error(`FCM auth failed (${response.status})`);
  cachedAccessToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return cachedAccessToken.value;
}

type AndroidPushMessage = {
  data: Record<string, string>;
  /** Shown by the system when present (messages); omitted for call pushes the app draws itself. */
  notification?: { title: string; body: string; channelId: string; tag?: string };
  ttlSeconds: number;
  collapseKey?: string;
};

export async function sendKristoPushToUser(userId: string, message: AndroidPushMessage) {
  const account = await loadServiceAccount();
  if (!account) {
    console.log("KRISTO_PUSH_SKIPPED", { reason: "fcm-not-configured", type: message.data.type });
    return { sent: 0, skipped: true };
  }
  const tokens = await pushTokensForUser(userId);
  if (!tokens.length) {
    console.log("KRISTO_PUSH_SKIPPED", { reason: "no-device", type: message.data.type, userId });
    return { sent: 0, skipped: true };
  }

  const bearer = await accessToken(account);
  let sent = 0;
  for (const token of tokens) {
    const body = {
      message: {
        token,
        data: message.data,
        android: {
          priority: "HIGH",
          ttl: `${Math.max(0, Math.floor(message.ttlSeconds))}s`,
          ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}),
          ...(message.notification
            ? {
                notification: {
                  title: message.notification.title,
                  body: message.notification.body,
                  channel_id: message.notification.channelId,
                  ...(message.notification.tag ? { tag: message.notification.tag } : {}),
                },
              }
            : {}),
        },
      },
    };
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (response.ok) {
      sent += 1;
      continue;
    }
    const error = await response.json().catch(() => ({}));
    const code = String(error?.error?.details?.[0]?.errorCode || error?.error?.status || response.status);
    console.log("KRISTO_PUSH_SEND_FAILED", { type: message.data.type, userId, code });
    if (code === "UNREGISTERED" || response.status === 404) await deletePushDevice(userId, token);
  }
  console.log("KRISTO_PUSH_SENT", { type: message.data.type, userId, sent, devices: tokens.length });
  return { sent, skipped: false };
}

/**
 * Incoming private call: data-only FCM so Android shows its own full-screen call notification,
 * and a VoIP push so iOS shows the CallKit incoming call.
 */
export async function notifyKristoCallPush(session: PrivateCallSession, title: string) {
  if (session.pastorSourceField === "soko-purchase-call") return;
  await notifyKristoApnsVoipCall(session, title).catch((error) =>
    console.log("KRISTO_VOIP_PUSH_FAILED", { callId: session.id, error: String(error?.message || error) })
  );
  await sendKristoPushToUser(session.pastorUserId, {
    data: {
      type: "private_call_incoming",
      callId: session.id,
      title,
      ringExpiresAt: String(session.ringExpiresAt || ""),
    },
    ttlSeconds: (Date.parse(String(session.ringExpiresAt || "")) - Date.now()) / 1000,
    collapseKey: `call-${session.id}`,
  });
}

/** The call was answered, declined or ended: the receiver's devices remove the ringing notification. */
export async function notifyKristoCallClosedPush(session: PrivateCallSession) {
  if (session.pastorSourceField === "soko-purchase-call") return;
  await sendKristoPushToUser(session.pastorUserId, {
    data: { type: "private_call_closed", callId: session.id, status: String(session.status || "") },
    ttlSeconds: 60,
    collapseKey: `call-${session.id}`,
  });
}

/** New direct message: a system notification so it shows even when the app is closed. */
export async function notifyKristoDirectMessagePush(input: {
  receiverUserId: string;
  roomId: string;
  title: string;
  body: string;
}) {
  await sendKristoPushToUser(input.receiverUserId, {
    data: { type: "direct_message", roomId: input.roomId },
    notification: { title: input.title, body: input.body, channelId: "kristo_messages", tag: input.roomId },
    ttlSeconds: 24 * 3600,
  });
}
