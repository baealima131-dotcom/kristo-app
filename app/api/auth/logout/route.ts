import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

export async function POST() {
  let res = NextResponse.json({ ok: true });
  res = clearSessionCookie(res);
  return res;
}
