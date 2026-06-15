export type LiveKitTokenClaims = {
  identity: string;
  room: string;
  exp: number;
  canPublish?: boolean;
  canSubscribe?: boolean;
  name?: string;
};

function decodeBase64UrlJson(part: string): Record<string, unknown> | null {
  try {
    const normalized = String(part || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const binary = globalThis.atob ? globalThis.atob(normalized + pad) : "";
    if (!binary) return null;
    return JSON.parse(binary) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeLiveKitTokenClaims(token: string): LiveKitTokenClaims | null {
  const parts = String(token || "").trim().split(".");
  if (parts.length < 2) return null;

  const payload = decodeBase64UrlJson(parts[1]);
  if (!payload) return null;

  const video =
    payload.video && typeof payload.video === "object"
      ? (payload.video as Record<string, unknown>)
      : null;

  return {
    identity: String(payload.sub || payload.identity || "").trim(),
    room: String(video?.room || payload.room || "").trim(),
    exp: Number(payload.exp || 0),
    canPublish:
      video?.canPublish === true ||
      payload.canPublish === true ||
      undefined,
    canSubscribe:
      video?.canSubscribe === true ||
      payload.canSubscribe === true ||
      undefined,
    name: String(payload.name || payload.metadata || "").trim() || undefined,
  };
}

export function logLiveKitTokenClaims(
  token: string,
  extra?: Record<string, unknown>
) {
  const claims = decodeLiveKitTokenClaims(token);
  console.log("KRISTO_LIVEKIT_TOKEN_DECODED", {
    ok: !!claims?.identity,
    identity: claims?.identity || "",
    room: claims?.room || "",
    exp: claims?.exp || 0,
    canPublish: claims?.canPublish,
    canSubscribe: claims?.canSubscribe,
    ...(extra || {}),
  });
  return claims;
}
