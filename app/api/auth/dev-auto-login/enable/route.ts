import { NextResponse } from "next/server";

export const runtime = "nodejs";

function forbidIfNotDev() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "Not available." }, { status: 404 });
  }
  return null;
}

export async function POST() {
  const blocked = forbidIfNotDev();
  if (blocked) return blocked;

  const res = NextResponse.json({ ok: true });

  // Enable dev auto-login again by clearing the disabling cookie.
  res.cookies.set({
    name: "kristo_dev_auto_login",
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    expires: new Date(0),
  });

  return res;
}

export async function GET() {
  return POST();
}
