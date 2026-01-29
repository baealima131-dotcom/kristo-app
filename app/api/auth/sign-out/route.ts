import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { vipRevokeSessionByToken } from "@/app/api/_lib/vipAuthStore";
import { VIP_SESSION_COOKIE } from "@/app/api/_lib/vipAuthCookies";

export async function POST() {
  const ck = await cookies();
  const token = ck.get(VIP_SESSION_COOKIE)?.value;

  if (token) vipRevokeSessionByToken(token);

  ck.set(VIP_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });

  return NextResponse.json({ ok: true });
}
