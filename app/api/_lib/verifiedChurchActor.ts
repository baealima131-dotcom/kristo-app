import { NextResponse } from "next/server";
import { getCheckoutViewer } from "@/app/api/_lib/auth";
import { getActiveMembership } from "@/app/api/_lib/memberships";
import { assertSafetyEnforcementAllows } from "@/app/api/_lib/rbac";

export type VerifiedChurchActor = {
  userId: string;
  churchId: string;
  /** Church role from the active membership (e.g. "Pastor", "Member"); "" when not a member. */
  churchRole: string;
};

/**
 * Signed-in user from a verified session token (or the server cookie session). Never from
 * x-kristo-user-id: unlike guard()/getViewer, there is no header-session fallback.
 * Safety enforcement (ban/suspend/restrict) applies.
 */
export async function resolveVerifiedUserId(req: Request): Promise<string | NextResponse> {
  const viewer = await getCheckoutViewer(req as any);
  const userId = String(viewer.userId || "").trim();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized", code: viewer.kind === "expired_session" ? "SESSION_EXPIRED" : "UNAUTHENTICATED" },
      { status: 401 }
    );
  }
  const safetyBlocked = await assertSafetyEnforcementAllows(userId, req.method);
  if (safetyBlocked) return safetyBlocked;
  return userId;
}

/**
 * Verified user plus the church and role of their active membership. A request whose
 * x-kristo-church-id names another church is refused instead of being re-pointed silently.
 */
export async function resolveVerifiedChurchActor(
  req: Request,
  logTag: string
): Promise<VerifiedChurchActor | NextResponse> {
  const userIdOrRes = await resolveVerifiedUserId(req);
  if (userIdOrRes instanceof NextResponse) return userIdOrRes;
  const userId = userIdOrRes;

  const membership = await getActiveMembership(userId);
  if (!membership?.churchId) {
    return NextResponse.json({ ok: false, error: "No active church membership" }, { status: 403 });
  }
  const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();
  if (headerChurchId && headerChurchId !== membership.churchId) {
    console.log("KRISTO_VERIFIED_ACTOR_CHURCH_MISMATCH", { route: logTag, userId, headerChurchId });
    return NextResponse.json({ ok: false, error: "Forbidden (church)" }, { status: 403 });
  }
  return { userId, churchId: membership.churchId, churchRole: String(membership.churchRole || "") };
}
