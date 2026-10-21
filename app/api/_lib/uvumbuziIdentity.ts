import { readCookieSessionUserId } from "@/app/api/auth/_lib/session";
import { verifySessionToken } from "@/app/api/auth/_lib/sessionToken";

/**
 * Identity for UVUMBUZI Lab requests comes ONLY from a verified Kristo session:
 * the HMAC-signed mobile token, or the server-side web cookie session.
 * Raw x-kristo-user-id / dev header identities are deliberately not accepted.
 */
export async function verifiedUvumbuziUserId(req: Request): Promise<string> {
  const token = String(req.headers.get("x-kristo-session-token") || "").trim();
  if (token) {
    const v = verifySessionToken(token);
    return v.ok && v.userId ? v.userId : "";
  }
  return readCookieSessionUserId();
}
