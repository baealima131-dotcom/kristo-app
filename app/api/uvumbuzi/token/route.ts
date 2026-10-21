import { NextResponse } from "next/server";
import { readCookieSessionUserId } from "@/app/api/auth/_lib/session";
import { verifySessionToken } from "@/app/api/auth/_lib/sessionToken";
import {
  issueUvumbuziBridgeToken,
  uvumbuziBridgeConfigFromEnv,
} from "@/app/api/_lib/uvumbuziBridgeToken";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Identity for the Lab bridge comes ONLY from a verified Kristo session:
 * the HMAC-signed mobile token, or the server-side web cookie session.
 * Raw x-kristo-user-id / dev header identities are deliberately not accepted.
 */
async function verifiedUserId(req: Request): Promise<string> {
  const token = String(req.headers.get("x-kristo-session-token") || "").trim();
  if (token) {
    const v = verifySessionToken(token);
    return v.ok && v.userId ? v.userId : "";
  }
  return readCookieSessionUserId();
}

export async function POST(req: Request) {
  const config = uvumbuziBridgeConfigFromEnv();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "UVUMBUZI Lab bridge is not configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  const userId = await verifiedUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const { token, expiresAt } = issueUvumbuziBridgeToken(userId, config);
    return NextResponse.json(
      { ok: true, subject: userId, token, expiresAt, labUrl: process.env.UVUMBUZI_LAB_URL || null },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Cannot issue Lab token for this account" }, { status: 422, headers: NO_STORE });
  }
}
