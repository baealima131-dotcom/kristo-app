import { NextResponse } from "next/server";

export async function GET() {
  // Dev identity defaults: local development only.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "Not available." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    NODE_ENV: process.env.NODE_ENV || null,
    KRISTO_DEV_USER_ID: process.env.KRISTO_DEV_USER_ID || null,
    KRISTO_DEV_ROLE: process.env.KRISTO_DEV_ROLE || null,
    KRISTO_DEV_CHURCH_ID: process.env.KRISTO_DEV_CHURCH_ID || null,
  });
}
