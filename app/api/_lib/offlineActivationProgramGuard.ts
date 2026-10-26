import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readCookieSessionUserId } from "@/app/api/auth/_lib/session";
import { verifySessionToken } from "@/app/api/auth/_lib/sessionToken";
import { getActiveMembership } from "@/app/api/_lib/memberships";
import {
  assertProgramMemberAllowed,
  ProgramError,
  type ProgramAccess,
} from "@/app/api/_lib/offlineActivationProgram";
import { resolvePlatformRoleForUser, type PlatformRole } from "@/app/api/_lib/platformRoles";
import { assertSafetyEnforcementAllows } from "@/app/api/_lib/rbac";
import { hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import {
  uvumbuziBridgeConfigFromEnv,
  verifyUvumbuziLabAdminToken,
} from "@/app/api/_lib/uvumbuziBridgeToken";

/**
 * Guard for the offline-activation program routes.
 *
 * Identity comes only from a verified credential: the HMAC-signed mobile
 * session token, the server-side web cookie session, or (System_Admin routes
 * only) a lab-admin pass signed by this server. Raw x-kristo-user-id headers
 * are never trusted here, in any environment. Every call re-reads the platform
 * role and the program member status, so a suspension or revocation applies to
 * the very next request.
 */

export type ProgramGuardContext = ProgramAccess & {
  via: "session" | "lab-admin-pass";
};

/**
 * Safety bans/suspensions live in Postgres. The local filesystem store used for
 * review/testing has no such table, so there (and only there) a missing
 * database means "no enforcement records". With a database, errors propagate.
 */
async function safetyBlock(userId: string, method: string) {
  try {
    return await assertSafetyEnforcementAllows(userId, method);
  } catch (error) {
    if (!hasDurableStore() && !isVercelRuntime()) return null;
    throw error;
  }
}

function json(data: unknown, status: number) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function programErrorResponse(error: unknown) {
  if (error instanceof ProgramError) {
    return json({ ok: false, error: error.message }, error.status);
  }
  const message = String((error as any)?.message || error || "Request failed");
  console.warn("KRISTO_OACT_PROGRAM_ERROR", { message: message.slice(0, 200) });
  return json({ ok: false, error: message }, 400);
}

/** Signed-in Kristo user (any role). */
export async function guardProgramUser(
  req: NextRequest
): Promise<{ userId: string } | NextResponse> {
  const token = String(req.headers.get("x-kristo-session-token") || "").trim();
  const headerUserId = String(req.headers.get("x-kristo-user-id") || "").trim();
  let userId = "";
  if (token) {
    const verified = verifySessionToken(token);
    userId = verified.ok && verified.userId ? verified.userId : "";
  } else {
    userId = await readCookieSessionUserId().catch(() => "");
  }
  if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);
  if (headerUserId && headerUserId !== userId) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const blocked = await safetyBlock(userId, req.method);
  if (blocked) return blocked;
  return { userId };
}

export async function guardProgram(
  req: NextRequest,
  roles: PlatformRole[],
  options: { allowLabAdminPass?: boolean } = {}
): Promise<ProgramGuardContext | NextResponse> {
  let userId = "";
  let via: ProgramGuardContext["via"] = "session";

  const authorization = String(req.headers.get("authorization") || "");
  if (authorization.startsWith("Bearer ")) {
    const config = uvumbuziBridgeConfigFromEnv();
    const canUsePass = options.allowLabAdminPass && roles.length === 1 && roles[0] === "System_Admin";
    userId = canUsePass && config ? verifyUvumbuziLabAdminToken(authorization.slice(7), config) : "";
    if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);
    via = "lab-admin-pass";
    const blocked = await safetyBlock(userId, req.method);
    if (blocked) return blocked;
  } else {
    const user = await guardProgramUser(req);
    if (user instanceof NextResponse) return user;
    userId = user.userId;
  }

  const active = await getActiveMembership(userId);
  const platformRole = await resolvePlatformRoleForUser(userId, active?.churchRole);
  if (!platformRole || !roles.includes(platformRole)) {
    console.log("KRISTO_OACT_PROGRAM_FORBIDDEN", { userId, required: roles, via });
    return json({ ok: false, error: "Forbidden (platform role)" }, 403);
  }

  try {
    const access = await assertProgramMemberAllowed(userId, platformRole);
    return { ...access, via };
  } catch (error) {
    return programErrorResponse(error);
  }
}
