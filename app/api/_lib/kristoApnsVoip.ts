import { createHash, createPrivateKey, createSign } from "node:crypto";
import http2 from "node:http2";

import { deletePushDevice, pushTokensForUser } from "@/app/api/_lib/store/pushDevicesDb";
import type { PrivateCallSession } from "@/app/api/_lib/privateCallSessions";

/**
 * iOS incoming calls: VoIP pushes through APNs (HTTP/2, token auth). Disabled unless an APNs auth
 * key is configured: KRISTO_APNS_KEY_P8 (the .p8 PEM, raw or base64), KRISTO_APNS_KEY_ID and
 * KRISTO_APPLE_TEAM_ID. KRISTO_IOS_BUNDLE_ID defaults to the App Store app; KRISTO_APNS_ORIGIN
 * (default https://api.push.apple.com) exists for tests.
 */

const DEFAULT_BUNDLE_ID = "com.princefariji.kristoapp.free";
const DEFAULT_ORIGIN = "https://api.push.apple.com";
const JWT_MAX_AGE_MS = 50 * 60 * 1000; // APNs accepts a token for up to an hour
const REQUEST_TIMEOUT_MS = 8000;

type ApnsConfig = { key: ReturnType<typeof createPrivateKey>; keyId: string; teamId: string; topic: string; origin: string };

let cachedJwt: { value: string; issuedAt: number } | null = null;

function loadApnsConfig(): ApnsConfig | null {
  const raw = String(process.env.KRISTO_APNS_KEY_P8 || "").trim();
  const keyId = String(process.env.KRISTO_APNS_KEY_ID || "").trim();
  const teamId = String(process.env.KRISTO_APPLE_TEAM_ID || "").trim();
  if (!raw || !keyId || !teamId) return null;
  try {
    const pem = raw.includes("BEGIN PRIVATE KEY") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const bundleId = String(process.env.KRISTO_IOS_BUNDLE_ID || DEFAULT_BUNDLE_ID).trim();
    return {
      key: createPrivateKey(pem),
      keyId,
      teamId,
      topic: `${bundleId}.voip`,
      origin: String(process.env.KRISTO_APNS_ORIGIN || DEFAULT_ORIGIN).trim(),
    };
  } catch (error) {
    console.log("KRISTO_APNS_KEY_UNREADABLE", { error: String((error as Error)?.message || error) });
    return null;
  }
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

/** ES256 provider token (JWT) for APNs. */
export function apnsProviderToken(config: Pick<ApnsConfig, "key" | "keyId" | "teamId">, now = Date.now()) {
  if (cachedJwt && now - cachedJwt.issuedAt < JWT_MAX_AGE_MS) return cachedJwt.value;
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const signature = createSign("SHA256")
    .update(`${header}.${claims}`)
    .sign({ key: config.key, dsaEncoding: "ieee-p1363" });
  cachedJwt = { value: `${header}.${claims}.${base64Url(signature)}`, issuedAt: now };
  return cachedJwt.value;
}

/** Stable CallKit UUID for a Kristo call, so every device shows the same incoming call. */
export function callKitUuidForCall(callId: string) {
  const hex = createHash("sha256").update(`kristo-call:${callId}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sendApnsRequest(
  origin: string,
  deviceToken: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; reason: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const client = http2.connect(origin);
    const finish = (status: number, reason: string) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve({ status, reason });
    };
    client.on("error", (error) => finish(0, String(error?.message || error)));
    const req = client.request({ ":method": "POST", ":path": `/3/device/${deviceToken}`, ...headers });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close();
      finish(0, "timeout");
    });
    let status = 0;
    let responseBody = "";
    req.setEncoding("utf8");
    req.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] || 0);
    });
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      let reason = "";
      try {
        reason = String(JSON.parse(responseBody || "{}")?.reason || "");
      } catch {}
      finish(status, reason);
    });
    req.on("error", (error) => finish(0, String(error?.message || error)));
    req.end(body);
  });
}

/** Incoming private call: a VoIP push to each of the receiver's iOS devices. */
export async function notifyKristoApnsVoipCall(session: PrivateCallSession, title: string) {
  if (session.pastorSourceField === "soko-purchase-call") return { sent: 0, skipped: true };
  const config = loadApnsConfig();
  if (!config) {
    console.log("KRISTO_VOIP_PUSH_SKIPPED", { reason: "apns-not-configured", callId: session.id });
    return { sent: 0, skipped: true };
  }
  const tokens = await pushTokensForUser(session.pastorUserId, "apns-voip");
  if (!tokens.length) return { sent: 0, skipped: true };

  const ringExpiresAtMs = Date.parse(String(session.ringExpiresAt || ""));
  const payload = JSON.stringify({
    aps: {},
    type: "private_call_incoming",
    callId: session.id,
    callUuid: callKitUuidForCall(session.id),
    callerName: String(session.callerName || title || "Kristo").trim(),
    ringExpiresAt: String(session.ringExpiresAt || ""),
  });
  const headers = {
    authorization: `bearer ${apnsProviderToken(config)}`,
    "apns-topic": config.topic,
    "apns-push-type": "voip",
    "apns-priority": "10",
    "apns-expiration": String(Number.isFinite(ringExpiresAtMs) ? Math.floor(ringExpiresAtMs / 1000) : 0),
    "content-type": "application/json",
  };

  let sent = 0;
  for (const token of tokens) {
    const result = await sendApnsRequest(config.origin, token, headers, payload);
    if (result.status === 200) {
      sent += 1;
      continue;
    }
    console.log("KRISTO_VOIP_PUSH_SEND_FAILED", { callId: session.id, status: result.status, reason: result.reason });
    if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered") {
      await deletePushDevice(session.pastorUserId, token);
    }
  }
  console.log("KRISTO_VOIP_PUSH_SENT", { callId: session.id, sent, devices: tokens.length });
  return { sent, skipped: false };
}
