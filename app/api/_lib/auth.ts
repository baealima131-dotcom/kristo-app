import type { NextRequest } from "next/server";
import {
  getUserById,
  readCookieSessionUserId,
  readSession,
  seedUserIfMissing,
} from "@/app/api/auth/_lib/session";
import {
  applyCheckoutIssuedCookieSession,
  logCheckoutAuthResolution,
  resolveCheckoutMobileIdentity,
  resolveRequestUserId,
} from "@/app/api/auth/_lib/sessionToken";

/**
 * Roles used across API RBAC.
 * NOTE: Church role + churchId are resolved from memberships in rbac.ts.
 */
export type AppRole =
  | "Member"
  | "Leader"
  | "Ministry_Leader"
  | "Pastor"
  | "Church_Admin"
  | "System_Admin";

export type Viewer = {
  userId: string;
  role: AppRole;
  churchId: string;
  name?: string;
};

async function devAutoViewer(): Promise<Viewer | null> {
  if (process.env.NODE_ENV !== "development") return null;
  if (process.env.KRISTO_DEV_AUTO_LOGIN !== "1") return null;

  const userId = process.env.KRISTO_DEV_USER_ID || "u-demo-1";
  const churchId = process.env.KRISTO_DEV_CHURCH_ID || "church-dev-1";
  const role = (process.env.KRISTO_DEV_ROLE as AppRole) || "Member";
  const u = await getUserById(userId);

  // Never use email as a public display name (notification privacy).
  return { userId, churchId, role, name: u?.kristoId || undefined };
}

function publicViewerName(user?: { kristoId?: string; id?: string } | null): string | undefined {
  const kristoId = String(user?.kristoId || "").trim();
  if (kristoId) return kristoId;
  return undefined;
}

export async function getViewer(req: NextRequest): Promise<Viewer> {
  await seedUserIfMissing();

  if (process.env.KRISTO_DEV_HEADER_AUTH === "1") {
    const url = new URL(req.url);

    const qDev = String(url.searchParams.get("devHeaderAuth") || "").trim();
    const headerUid = String(req.headers.get("x-kristo-user-id") || "").trim();
    const headerRole = String(req.headers.get("x-kristo-role") || "Member").trim();
    const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();
    const headerName = String(
      req.headers.get("x-kristo-user-name") ||
        req.headers.get("x-kristo-display-name") ||
        req.headers.get("x-kristo-name") ||
        ""
    ).trim();

    if (headerUid) {
      const role = (headerRole as AppRole) || "Member";
      const name =
        headerName && !headerName.includes("@") && headerName !== headerUid
          ? headerName
          : undefined;
      return { userId: headerUid, name, role, churchId: headerChurchId };
    }

    if (process.env.NODE_ENV === "development" && qDev === "1") {
      const userId = process.env.KRISTO_DEV_USER_ID || "u-demo-1";
      const churchId = process.env.KRISTO_DEV_CHURCH_ID || "c-demo-1";
      const role = (process.env.KRISTO_DEV_ROLE as AppRole) || "System_Admin";
      const u = await getUserById(userId);
      return { userId, churchId, role, name: publicViewerName(u) };
    }
  }

  const dev = await devAutoViewer();
  if (dev) return dev;

  const resolved = resolveRequestUserId(req);
  if (resolved.userId) {
    const u = await getUserById(resolved.userId);
    const headerRole = String(req.headers.get("x-kristo-role") || "Member").trim();
    const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();
    return {
      userId: resolved.userId,
      name: publicViewerName(u),
      role: (headerRole as AppRole) || "Member",
      churchId: headerChurchId,
    };
  }

  // Cookie session fallback (web), or Stage-1 legacy header-session for
  // existing profile/church mobile clients. Checkout must not use this path.
  const sess = await readSession(req);
  if (!sess) {
    return { userId: "", name: undefined, role: "Member", churchId: "" };
  }

  const u = await getUserById(sess.userId);

  return {
    userId: sess.userId,
    name: publicViewerName(u),
    role: "Member",
    churchId: "",
  };
}

/**
 * Checkout identity for Kristo Home / SOKO buyers.
 * HMAC-verified mobile token first. Cookie-sid lookup in the server
 * session store is the only fallback. Never use readSession(): that path
 * synthesizes identity from x-kristo-user-id without validating a session.
 */
export async function getCheckoutViewer(req: NextRequest): Promise<{
  userId: string;
  via: string;
  tokenVerified: boolean;
  profileHydrated: false;
  kind:
    | "ok"
    | "unauthenticated"
    | "expired_session"
    | "valid_session_token_unverified";
  reason?: string | null;
}> {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.KRISTO_DEV_AUTO_LOGIN === "1"
  ) {
    return {
      userId: process.env.KRISTO_DEV_USER_ID || "u-demo-1",
      via: "dev-auto",
      tokenVerified: false,
      profileHydrated: false,
      kind: "ok",
    };
  }

  const identity = resolveCheckoutMobileIdentity(req);
  if (identity.userId && identity.tokenVerified) {
    logCheckoutAuthResolution(identity);
    return {
      userId: identity.userId,
      via: identity.via,
      tokenVerified: true,
      profileHydrated: false,
      kind: identity.kind,
      reason: identity.reason,
    };
  }

  const cookieUserId = await readCookieSessionUserId();
  const withCookie = applyCheckoutIssuedCookieSession(identity, {
    id: cookieUserId ? "cookie-sid" : "",
    userId: cookieUserId,
  });
  if (withCookie.userId) {
    logCheckoutAuthResolution({
      ...withCookie,
      fallbackUser: true,
    });
    return {
      userId: withCookie.userId,
      via: withCookie.via,
      tokenVerified: false,
      profileHydrated: false,
      kind: withCookie.kind,
      reason: withCookie.reason,
    };
  }

  logCheckoutAuthResolution(identity);
  return {
    userId: "",
    via: identity.via || "none",
    tokenVerified: false,
    profileHydrated: false,
    kind: identity.kind,
    reason: identity.reason,
  };
}
