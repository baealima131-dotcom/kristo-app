import { NextResponse } from "next/server";
import { clearSessionCookie, destroyCookieSession } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

export async function POST() {
  // Signed mobile tokens are stateless and stay valid until they expire (see review notes);
  // only the server cookie session can be revoked here.
  await destroyCookieSession();
  let res = NextResponse.json({ ok: true });
  res = clearSessionCookie(res);
  return res;
}
