import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getChurchStoreDiagnostics } from "@/app/api/_lib/store/churchDb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userId = String(
      url.searchParams.get("userId") ||
        req.headers.get("x-kristo-user-id") ||
        ""
    ).trim();
    const churchId = String(
      url.searchParams.get("churchId") ||
        req.headers.get("x-kristo-church-id") ||
        ""
    ).trim();

    const diagnostics = await getChurchStoreDiagnostics({ userId, churchId });
    const status =
      diagnostics.vercel && !diagnostics.hasDatabaseUrl ? 503 : diagnostics.ok ? 200 : 503;

    return NextResponse.json({ ok: diagnostics.ok, ...diagnostics }, { status });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.message || error || "Church diagnostic failed"),
        reason: "church_diagnostic_failed",
      },
      { status: 500 }
    );
  }
}
