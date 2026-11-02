import { NextResponse } from "next/server";
import { getAuthStoreDiagnostics } from "@/app/api/_lib/store/authDb";
import { getChurchStoreDiagnostics } from "@/app/api/_lib/store/churchDb";
import { getPlatformRole } from "@/app/api/_lib/platformRoles";
import { resolveVerifiedUserId } from "@/app/api/_lib/verifiedChurchActor";

export const runtime = "nodejs";

/** Full store details (user counts, DB errors, env flags) only for a verified System_Admin. */
async function isSystemAdminRequest(req: Request) {
  const userIdOrRes = await resolveVerifiedUserId(req, { safetyMethod: "GET" });
  if (userIdOrRes instanceof NextResponse) return false;
  return (await getPlatformRole(userIdOrRes).catch(() => null)) === "System_Admin";
}

export async function GET(req: Request) {
  const detailed = await isSystemAdminRequest(req).catch(() => false);
  try {
    const diagnostics = await getAuthStoreDiagnostics();
    const church = await getChurchStoreDiagnostics();
    const status = diagnostics.vercel && !diagnostics.hasDatabaseUrl ? 503 : diagnostics.ok && church.ok ? 200 : 503;
    if (!detailed) {
      if (status !== 200) {
        console.error("KRISTO_AUTH_DIAGNOSTIC_UNHEALTHY", {
          authStoreError: diagnostics.storeError,
          churchStoreError: (church as any)?.storeError || null,
        });
      }
      return NextResponse.json({ ok: status === 200 }, { status });
    }
    return NextResponse.json(
      {
        ok: diagnostics.ok && church.ok,
        auth: diagnostics,
        church,
      },
      { status }
    );
  } catch (error: any) {
    console.error("KRISTO_AUTH_DIAGNOSTIC_FAILED", { error: String(error?.message || error) });
    return NextResponse.json(
      detailed
        ? {
            ok: false,
            error: String(error?.message || error || "Diagnostic failed"),
            reason: "auth_diagnostic_failed",
          }
        : { ok: false, reason: "auth_diagnostic_failed" },
      { status: 500 }
    );
  }
}
