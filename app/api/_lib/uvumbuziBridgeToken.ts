import crypto from "node:crypto";

/**
 * UVUMBUZI Lab bridge: a short-lived RS256 access token so the existing Lab
 * can recognise a signed-in Kristo user without a second account.
 *
 * Kristo keeps the PRIVATE key (server env only). The Lab receives only the
 * PUBLIC key and verifies `iss`, `aud`, `exp`, `sub`. The Kristo session secret
 * (KRISTO_SESSION_SECRET) is never shared with the Lab.
 *
 * Disabled (returns null config) unless all of these are set:
 *   UVUMBUZI_BRIDGE_PRIVATE_KEY_PEM_BASE64  base64 of an RSA private key PEM
 *   UVUMBUZI_BRIDGE_ISSUER                  must equal Lab KRISTO_BRIDGE_ISSUER
 *   UVUMBUZI_BRIDGE_AUDIENCE                must equal Lab KRISTO_BRIDGE_AUDIENCE
 */

export const UVUMBUZI_BRIDGE_TOKEN_TTL_SECONDS = 300;

export type UvumbuziBridgeConfig = {
  privateKey: crypto.KeyObject;
  issuer: string;
  audience: string;
};

export function uvumbuziBridgeConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): UvumbuziBridgeConfig | null {
  const keyB64 = String(env.UVUMBUZI_BRIDGE_PRIVATE_KEY_PEM_BASE64 || "").trim();
  const issuer = String(env.UVUMBUZI_BRIDGE_ISSUER || "").trim();
  const audience = String(env.UVUMBUZI_BRIDGE_AUDIENCE || "").trim();
  if (!keyB64 || !issuer || !audience) return null;
  try {
    const privateKey = crypto.createPrivateKey(Buffer.from(keyB64, "base64").toString("utf8"));
    if (privateKey.asymmetricKeyType !== "rsa") return null;
    return { privateKey, issuer, audience };
  } catch {
    return null;
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign a bridge token for an already-verified Kristo user id. */
export function issueUvumbuziBridgeToken(
  userId: string,
  config: UvumbuziBridgeConfig,
  nowMs: number = Date.now()
): { token: string; expiresAt: string } {
  const sub = String(userId || "").trim();
  // Same subject rule the Lab enforces, so a token is never issued that the Lab rejects.
  if (!/^[\w.:-]{1,200}$/.test(sub)) throw new Error("uvumbuzi-bridge: unsupported user id");
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + UVUMBUZI_BRIDGE_TOKEN_TTL_SECONDS;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ iss: config.issuer, aud: config.audience, sub, iat, nbf: iat, exp, jti: crypto.randomUUID() })
  );
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), config.privateKey).toString("base64url");
  return { token: `${head}.${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}
