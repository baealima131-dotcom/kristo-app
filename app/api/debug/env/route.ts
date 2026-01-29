import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    NODE_ENV: process.env.NODE_ENV || null,
    KRISTO_DEV_USER_ID: process.env.KRISTO_DEV_USER_ID || null,
    KRISTO_DEV_ROLE: process.env.KRISTO_DEV_ROLE || null,
    KRISTO_DEV_CHURCH_ID: process.env.KRISTO_DEV_CHURCH_ID || null,
  });
}
