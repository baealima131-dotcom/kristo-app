import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  dbGetActiveSafetyAccountEnforcement,
} from "@/app/api/_lib/store/safetyReportDb";
import {
  loadSafetyEnforcementCached,
  readSafetyEnforcementCache,
} from "@/app/api/_lib/safetyEnforcementCache";
import { sokoCheckoutTimer } from "@/app/api/_lib/sokoCheckoutTiming";

import { getCheckoutViewer, getViewer } from "@/app/api/_lib/auth";
import { describeCheckoutAuthDiag, describeSessionSecretConfig } from "@/app/api/auth/_lib/sessionToken";
import {
  getActiveMembership,
  requestMembership,
  approveMembership,
  type ChurchRole,
  devPromoteToRoleIfActive,
} from "@/app/api/_lib/memberships";
import {
  canAccessOfflineActivationAdmin,
  isSystemAdminPlatformRole,
  resolveChurchRoleForGuard,
  resolvePlatformRoleForUser,
  type PlatformRole,
} from "@/app/api/_lib/platformRoles";

export type Role = "System_Admin" | "Pastor" | "Church_Admin" | "Ministry_Leader" | "Leader" | "Member";

export type GuardContext = {
  viewer: {
    userId: string;
    name?: string;
    role: Role;
  };
  churchId: string; // only set when Active membership exists
};

type AuthOnlyContext = {
  viewer: {
    userId: string;
    name?: string;
  };
};

type ApiErr = { ok: false; error: string; details?: unknown };

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function authDebugLog(label: string, details?: Record<string, unknown>) {
  if (process.env.KRISTO_DEBUG_AUTH === "1" || isDev()) {
    console.log(`[rbac] ${label}`, details || {});
  }
}

function devDefaultChurchId() {
  return "church_dev_default";
}

export function isSystemAdminRole(role: unknown): boolean {
  return isSystemAdminPlatformRole(role);
}

/** @deprecated Use canAccessOfflineActivationAdmin(platformRole) with platform role, not churchRole. */
export function canAccessOfflineActivationAdminRole(role: unknown): boolean {
  return canAccessOfflineActivationAdmin(role);
}

export { canAccessOfflineActivationAdmin };

export function mapChurchRoleToRole(r: ChurchRole | undefined): Role {
  const churchRole = resolveChurchRoleForGuard(r);
  if (churchRole === "Pastor") return "Pastor";
  if (churchRole === "Church_Admin") return "Church_Admin";
  if (churchRole === "Ministry_Leader") return "Ministry_Leader";
  if (churchRole === "Leader") return "Leader";
  return "Member";
}

/**
 * DEV helper:
 * Optionally auto-create + approve membership so app works immediately after login.
 * You can disable by setting KRISTO_DEV_AUTO_MEMBERSHIP=0
 */
function devAutoMembershipEnabled() {
  const v = String(process.env.KRISTO_DEV_AUTO_MEMBERSHIP || "").trim();
  if (!v) return true;
  return v !== "0" && v.toLowerCase() !== "false";
}

async function ensureDevActiveMembership(userId: string, name?: string) {
  if (!isDev()) return;
  if (!devAutoMembershipEnabled()) return;

  const active = await getActiveMembership(userId);
  if (active) return;

  const reqRes = await requestMembership(userId, devDefaultChurchId(), name);
  if (!reqRes.ok) return;

  await approveMembership(reqRes.membership.id, userId);
  await devPromoteToRoleIfActive(userId, devDefaultChurchId(), "Pastor");
}

/** Auth only: user must be signed in, no church required */
async function requireAuthOnly(req: NextRequest): Promise<AuthOnlyContext | NextResponse> {
  const headerUid = String(req.headers.get("x-kristo-user-id") || "").trim();
  const headerRole = String(req.headers.get("x-kristo-role") || "").trim();
  const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();

  const v = await getViewer(req);
  const userId = String((v as any).userId || "").trim();
  const name = (v as any).name ? String((v as any).name) : undefined;
  const role = String((v as any).role || "").trim();
  const churchId = String((v as any).churchId || "").trim();

  if (!userId) {
    authDebugLog("Unauthorized", {
      headerUid,
      headerRole,
      headerChurchId,
      hasCookie: Boolean(req.headers.get("cookie")),
    });
    return json(
      {
        ok: false,
        error: "Unauthorized",
        details: { hint: "You must be signed in." },
      } satisfies ApiErr,
      { status: 401 }
    );
  }

  return { viewer: { userId, name, role, churchId } as any };
}

/** Active membership required: churchId + role come from membership store */
async function requireActiveMembership(req: NextRequest): Promise<GuardContext | NextResponse> {
  const a = await requireAuthOnly(req);
  if (a instanceof NextResponse) return a;

  const { userId, name } = a.viewer;
  const authRole = String((a.viewer as any).role || "").trim();
  const authChurchId = String((a.viewer as any).churchId || "").trim();

  // DEV: optional auto-provision
  await ensureDevActiveMembership(userId, name);

  const active = await getActiveMembership(userId);
  if (!active) {
    authDebugLog("No active church membership", {
      userId,
      headerChurchId: authChurchId,
      headerRole: authRole,
    });
    return json(
      {
        ok: false,
        error: "No active church membership",
        details: {
          hint: "Join a church first (send a request).",
        },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  const role = mapChurchRoleToRole(active.churchRole);
  return { viewer: { userId, name, role }, churchId: active.churchId };
}

export function requireRole(ctx: GuardContext, roles: Role[]): GuardContext | NextResponse {
  if (roles.includes(ctx.viewer.role)) return ctx;

  return json(
    {
      ok: false,
      error: "Forbidden (role)",
      details: { required: roles, youAre: ctx.viewer.role },
    } satisfies ApiErr,
    { status: 403 }
  );
}

/**
 * Enforce Safety account blocks on every authenticated request path.
 * Permanent ban / suspend → block all methods.
 * Restrict → block write methods only (post, comment, message, live, upload, etc.).
 * Expired suspend/restrict rows are marked expired inside the lookup.
 *
 * Exported so header-only routes (room-messages, live, livekit, uploads)
 * can reuse the same canonical assertion after resolving identity their
 * own way — without inventing a second enforcement implementation.
 */
export async function assertSafetyEnforcementAllows(
  userId: string,
  method: string
): Promise<NextResponse | null> {
  const loaded = await loadSafetyEnforcementCached(userId, async () => {
    const enforcement = await dbGetActiveSafetyAccountEnforcement(userId);
    return {
      permanentBan: Boolean(enforcement.permanentBan),
      suspension: Boolean(enforcement.suspension),
      restriction: Boolean(enforcement.restriction),
    };
  });
  logGuardAuthTiming("safety_lookup", {
    cacheHit: loaded.cacheHit,
    coalesced: loaded.coalesced,
    queried: !loaded.cacheHit && !loaded.coalesced,
  });
  const enforcement = loaded.value;

  if (enforcement.permanentBan) {
    console.log(
      JSON.stringify({
        scope: "kristo_safety",
        event: "auth_blocked",
        code: "SAFETY_PERMANENT_BAN",
        userId,
        at: new Date().toISOString(),
      })
    );

    return json(
      {
        ok: false,
        error:
          "This Kristo account has been permanently banned.",
        details: {
          code: "SAFETY_PERMANENT_BAN",
        },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  if (enforcement.suspension) {
    console.log(
      JSON.stringify({
        scope: "kristo_safety",
        event: "auth_blocked",
        code: "SAFETY_ACCOUNT_SUSPENDED",
        userId,
        at: new Date().toISOString(),
      })
    );

    return json(
      {
        ok: false,
        error:
          "This Kristo account is temporarily suspended.",
        details: {
          code: "SAFETY_ACCOUNT_SUSPENDED",
        },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  const normalizedMethod = String(method || "GET")
    .trim()
    .toUpperCase();

  const writeRequest =
    normalizedMethod !== "GET" &&
    normalizedMethod !== "HEAD" &&
    normalizedMethod !== "OPTIONS";

  if (writeRequest && enforcement.restriction) {
    console.log(
      JSON.stringify({
        scope: "kristo_safety",
        event: "auth_blocked",
        code: "SAFETY_ACCOUNT_RESTRICTED",
        userId,
        method: normalizedMethod,
        at: new Date().toISOString(),
      })
    );

    return json(
      {
        ok: false,
        error:
          "This Kristo account is temporarily restricted to read-only access.",
        details: {
          code: "SAFETY_ACCOUNT_RESTRICTED",
        },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  return null;
}

/** Block sign-in / token issue for banned or suspended accounts only. */
export async function assertSafetyAllowsAuthentication(
  userId: string
): Promise<NextResponse | null> {
  const enforcement =
    await dbGetActiveSafetyAccountEnforcement(
      userId
    );

  if (enforcement.permanentBan) {
    return json(
      {
        ok: false,
        error:
          "This Kristo account has been permanently banned.",
        details: {
          code: "SAFETY_PERMANENT_BAN",
          reportId:
            enforcement.permanentBan.reportId,
        },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  if (enforcement.suspension) {
    return json(
      {
        ok: false,
        error:
          "This Kristo account is temporarily suspended.",
        details: {
          code: "SAFETY_ACCOUNT_SUSPENDED",
          expiresAt:
            enforcement.suspension.expiresAt ||
            null,
          reportId:
            enforcement.suspension.reportId,
        },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  return null;
}

function logGuardAuthTiming(
  route: string,
  stages: Record<string, unknown>
) {
  const safe: Record<string, unknown> = { route };
  for (const [key, value] of Object.entries(stages)) {
    if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
    if (typeof value === "string" && value.length <= 40) {
      safe[key] = value;
    }
  }
  console.log("KRISTO_GUARD_AUTH_TIMING", safe);
}

/** ✅ Use this for endpoints that only require login (no church yet) */
export async function guardAuth(
  req: NextRequest
): Promise<
  AuthOnlyContext |
  NextResponse
> {
  const started = Date.now();
  const auth =
    await requireAuthOnly(req);
  const viewerMs = Date.now() - started;

  if (
    auth instanceof NextResponse
  ) {
    logGuardAuthTiming("guardAuth", {
      viewerMs,
      safetyMs: 0,
      ok: false,
      profileHydrated: true,
    });
    return auth;
  }

  const safetyStarted = Date.now();
  const blocked =
    await assertSafetyEnforcementAllows(
      auth.viewer.userId,
      req.method
    );
  const safetyMs = Date.now() - safetyStarted;
  logGuardAuthTiming("guardAuth", {
    viewerMs,
    safetyMs,
    totalMs: Date.now() - started,
    ok: !blocked,
    profileHydrated: true,
  });

  if (blocked) {
    return blocked;
  }

  return auth;
}

/**
 * Checkout writes: signed session token (expiry + uid bind) without
 * profile/church hydration. Safety bans/suspends/restricts still apply.
 */
export async function guardCheckoutAuth(
  req: NextRequest
): Promise<AuthOnlyContext | NextResponse> {
  const timer = sokoCheckoutTimer("checkout-auth");
  const viewer = await getCheckoutViewer(req);
  const diag = describeCheckoutAuthDiag(req);
  console.log("KRISTO_SOKO_CHECKOUT_AUTH_DIAG", {
    via: viewer.via,
    verified: viewer.tokenVerified,
    profileHydrated: viewer.profileHydrated,
    hasUserId: Boolean(viewer.userId),
    kind: viewer.kind,
    reason: viewer.reason || diag.verifyReason,
    hasHeaderUserId: diag.hasHeaderUserId,
    hasSessionToken: diag.hasSessionToken,
    sessionTokenLen: diag.sessionTokenLen,
    hasSessionSecret: diag.hasSessionSecret,
    verifyOk: diag.verifyOk,
    verifyReason: diag.verifyReason,
    verifiedVia: diag.verifiedVia,
    headerUidHash: diag.headerUidHash,
    tokenUidHash: diag.tokenUidHash,
    tokenVersion: diag.tokenVersion,
    tokenIssuer: diag.tokenIssuer,
    resolveVia: diag.resolveVia,
    resolveOk: diag.resolveOk,
    secrets: describeSessionSecretConfig(),
  });
  timer.stage("token_verify", {
    via: viewer.via,
    verified: viewer.tokenVerified,
    profileHydrated: viewer.profileHydrated,
    hasUserId: Boolean(viewer.userId),
    verifyOk: diag.verifyOk,
    resolveOk: diag.resolveOk,
  });

  if (!viewer.userId) {
    const code =
      viewer.kind === "expired_session"
        ? "CHECKOUT_SESSION_EXPIRED"
        : "CHECKOUT_UNAUTHENTICATED";
    return json(
      {
        ok: false,
        error: "Unauthorized",
        details: {
          hint: "You must be signed in.",
          code,
          reason: viewer.reason || null,
        },
      } satisfies ApiErr,
      { status: 401 }
    );
  }

  const safetyCached = Boolean(readSafetyEnforcementCache(viewer.userId));
  const blocked = await assertSafetyEnforcementAllows(
    viewer.userId,
    req.method
  );
  timer.stage("safety", {
    blocked: Boolean(blocked),
    cacheHit: safetyCached,
  });

  if (blocked) return blocked;

  return { viewer: { userId: viewer.userId } };
}

/** ✅ Use this for church-scoped endpoints (Active membership required) */
export async function guard(req: NextRequest, roles?: Role[]): Promise<GuardContext | NextResponse> {
  const ctxOrRes = await requireActiveMembership(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const blocked =
    await assertSafetyEnforcementAllows(
      ctxOrRes.viewer.userId,
      req.method
    );

  if (blocked) {
    return blocked;
  }

  if (roles && roles.length > 0) {
    const roleOrRes = requireRole(ctxOrRes, roles);
    if (roleOrRes instanceof NextResponse) return roleOrRes;
    return roleOrRes;
  }

  return ctxOrRes;
}

export type PlatformGuardContext = {
  viewer: {
    userId: string;
    name?: string;
  };
  platformRole: PlatformRole;
};

/** Platform offline-activation routes — uses platformRole, not churchRole. */
export async function guardPlatformOfflineActivation(
  req: NextRequest,
  roles: PlatformRole[]
): Promise<PlatformGuardContext | NextResponse> {
  const headerUserId = String(req.headers.get("x-kristo-user-id") || "").trim();
  const hasSessionToken = Boolean(String(req.headers.get("x-kristo-session-token") || "").trim());

  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  const active = await getActiveMembership(userId);
  const platformRole = await resolvePlatformRoleForUser(userId, active?.churchRole);

  console.log("KRISTO_PLATFORM_GUARD_CONTEXT", {
    userId: userId || null,
    platformRole: platformRole || null,
    requiredRoles: roles,
    hasHeaderUserId: Boolean(headerUserId),
    hasSessionToken,
    allowed: Boolean(platformRole && roles.includes(platformRole)),
  });

  if (!platformRole || !roles.includes(platformRole)) {
    return json(
      {
        ok: false,
        error: "Forbidden (platform role)",
        details: { required: roles, youAre: platformRole || null },
      } satisfies ApiErr,
      { status: 403 }
    );
  }

  return { viewer: { userId, name: auth.viewer.name }, platformRole };
}
