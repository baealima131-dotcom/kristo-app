import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { dbGetMySokoSystemMessages } from "@/app/api/_lib/store/sokoSellerAccessDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, no-cache, must-revalidate" };
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) {
    auth.headers.set("Cache-Control", headers["Cache-Control"]);
    return auth;
  }
  try {
    // No recipient, sender, or role is accepted from query/body parameters.
    const messages = await dbGetMySokoSystemMessages(auth.viewer.userId);
    return NextResponse.json({ ok: true, messages }, { headers });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not load your System Admin messages. Try again." },
      { status: 503, headers },
    );
  }
}
