import { NextResponse } from "next/server";
import { verifiedUvumbuziUserId } from "@/app/api/_lib/uvumbuziIdentity";
import {
  issueUvumbuziBridgeToken,
  uvumbuziBridgeConfigFromEnv,
} from "@/app/api/_lib/uvumbuziBridgeToken";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const config = uvumbuziBridgeConfigFromEnv();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "UVUMBUZI Lab bridge is not configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  const userId = await verifiedUvumbuziUserId(req);
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
