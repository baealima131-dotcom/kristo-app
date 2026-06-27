import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getViewer } from "@/app/api/_lib/auth";
import {
  getActiveMembership,
  requestMembership,
  approveMembership,
  type ChurchRole,
  devPromoteToRoleIfActive,
} from "@/app/api/_lib/memberships";

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
  return String(role || "").trim() === "System_Admin";
}

/** Platform offline activation admin workspace (System_Admin only). */
export function canAccessOfflineActivationAdmin(role: unknown): boolean {
  return isSystemAdminRole(role);
}

export function mapChurchRoleToRole(r: ChurchRole | undefined): Role {
  if (r === "System_Admin") return "System_Admin";
  if (r === "Pastor") return "Pastor";
  if (r === "Church_Admin") return "Church_Admin";
  if (r === "Ministry_Leader") return "Ministry_Leader";
  if (r === "Leader") return "Leader";
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

/** ✅ Use this for endpoints that only require login (no church yet) */
export async function guardAuth(req: NextRequest): Promise<AuthOnlyContext | NextResponse> {
  return requireAuthOnly(req);
}

/** ✅ Use this for church-scoped endpoints (Active membership required) */
export async function guard(req: NextRequest, roles?: Role[]): Promise<GuardContext | NextResponse> {
  const ctxOrRes = await requireActiveMembership(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  if (roles && roles.length > 0) {
    const roleOrRes = requireRole(ctxOrRes, roles);
    if (roleOrRes instanceof NextResponse) return roleOrRes;
    return roleOrRes;
  }

  return ctxOrRes;
}
