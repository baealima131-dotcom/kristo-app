import { NextResponse } from "next/server";
import { getAuthStoreDiagnostics } from "@/app/api/_lib/store/authDb";

export const runtime = "nodejs";

export async function GET() {
  try {
    const diagnostics = await getAuthStoreDiagnostics();
    const status = diagnostics.vercel && !diagnostics.hasDatabaseUrl ? 503 : diagnostics.ok ? 200 : 503;
    return NextResponse.json({ ok: diagnostics.ok, ...diagnostics }, { status });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.message || error || "Diagnostic failed"),
        reason: "auth_diagnostic_failed",
      },
      { status: 500 }
    );
  }
}
