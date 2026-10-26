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
export const CLOCK_SKEW_SECONDS = 30;

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
    // nbf 30 s in the past tolerates a Lab clock slightly behind Kristo's (the Lab allows the same skew).
    JSON.stringify({ iss: config.issuer, aud: config.audience, sub, iat, nbf: iat - CLOCK_SKEW_SECONDS, exp, jti: crypto.randomUUID() })
  );
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), config.privateKey).toString("base64url");
  return { token: `${head}.${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * UVUMBUZI Lab admin pass: same RS256 issuer/audience as the bridge, but with
 * `scope: "uvumbuzi:lab-admin"`. Issued only after a System_Admin sign-in code
 * is exchanged; the Lab checks the scope, and Kristo re-checks the System_Admin
 * role on every admin request, so revoking the role ends access immediately.
 */
export const UVUMBUZI_LAB_ADMIN_SCOPE = "uvumbuzi:lab-admin";
export const UVUMBUZI_LAB_ADMIN_TOKEN_TTL_SECONDS = 900;

export function issueUvumbuziLabAdminToken(
  userId: string,
  config: UvumbuziBridgeConfig,
  nowMs: number = Date.now()
): { token: string; expiresAt: string } {
  const sub = String(userId || "").trim();
  if (!/^[\w.:-]{1,200}$/.test(sub)) throw new Error("uvumbuzi-bridge: unsupported user id");
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + UVUMBUZI_LAB_ADMIN_TOKEN_TTL_SECONDS;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      iss: config.issuer,
      aud: config.audience,
      sub,
      iat,
      nbf: iat - CLOCK_SKEW_SECONDS,
      exp,
      jti: crypto.randomUUID(),
      scope: UVUMBUZI_LAB_ADMIN_SCOPE,
    })
  );
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), config.privateKey).toString("base64url");
  return { token: `${head}.${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Returns the subject of a valid, unexpired lab-admin pass signed by this Kristo server, else "". */
export function verifyUvumbuziLabAdminToken(
  token: string,
  config: UvumbuziBridgeConfig,
  nowMs: number = Date.now()
): string {
  const raw = String(token || "").trim();
  if (raw.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return "";
  const [head, body, sig] = raw.split(".");
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    if (header?.alg !== "RS256") return "";
    const publicKey = crypto.createPublicKey(config.privateKey);
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, "base64url"));
    if (!ok) return "";
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(nowMs / 1000);
    if (
      claims?.iss !== config.issuer ||
      claims?.aud !== config.audience ||
      claims?.scope !== UVUMBUZI_LAB_ADMIN_SCOPE ||
      typeof claims.exp !== "number" ||
      claims.exp <= now - CLOCK_SKEW_SECONDS ||
      typeof claims.iat !== "number" ||
      claims.exp - claims.iat > UVUMBUZI_LAB_ADMIN_TOKEN_TTL_SECONDS ||
      typeof claims.sub !== "string" ||
      !/^[\w.:-]{1,200}$/.test(claims.sub)
    ) {
      return "";
    }
    return claims.sub;
  } catch {
    return "";
  }
}
