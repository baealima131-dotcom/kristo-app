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

  // Disable header-auth for this browser/curl jar (instead of env var).
  res.cookies.set({
    name: "kristo_dev_header_auth",
    value: "0",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  });

  return res;
}

export async function GET() {
  return POST();
}
