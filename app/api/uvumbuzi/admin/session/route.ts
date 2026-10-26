import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { appendOfflineActivationAudit } from "@/app/api/_lib/offlineActivationAudit";
import { consumeAdminLoginCode, ProgramError } from "@/app/api/_lib/offlineActivationProgram";
import { programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";
import { getPlatformRole } from "@/app/api/_lib/platformRoles";
import { RelayRateLimiter } from "@/app/api/_lib/uvumbuziLabProxy";
import {
  issueUvumbuziLabAdminToken,
  uvumbuziBridgeConfigFromEnv,
} from "@/app/api/_lib/uvumbuziBridgeToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

const limiter = new RelayRateLimiter(20, 60_000);

/**
 * Server-to-server (UVUMBUZI Lab → Kristo): exchange a one-time admin sign-in code
 * for a 15-minute lab-admin pass. The System_Admin role is checked again here and
 * on every admin request made with the pass.
 */
export async function POST(req: NextRequest) {
  const config = uvumbuziBridgeConfigFromEnv();
  if (!config) return json({ ok: false, error: "UVUMBUZI bridge not configured" }, 503);
  const client = String(req.headers.get("x-forwarded-for") || "lab").split(",")[0].trim();
  if (limiter.take(client) > 0) return json({ ok: false, error: "Too many attempts" }, 429);

  const body = await req.json().catch(() => ({}));
  try {
    const userId = await consumeAdminLoginCode(String(body?.code || ""));
    if ((await getPlatformRole(userId)) !== "System_Admin") {
      throw new ProgramError(403, "Forbidden (platform role)");
    }
    const pass = issueUvumbuziLabAdminToken(userId, config);
    await appendOfflineActivationAudit({
      actorUserId: userId,
      actorRole: "System_Admin",
      action: "admin.session_issued",
      targetType: "admin_session",
      targetId: userId,
      details: { expiresAt: pass.expiresAt },
    });
    return json({ ok: true, token: pass.token, expiresAt: pass.expiresAt, subject: userId });
  } catch (error) {
    return programErrorResponse(error);
  }
}
