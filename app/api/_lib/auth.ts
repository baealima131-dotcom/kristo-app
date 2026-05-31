import type { NextRequest } from "next/server";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById, readSession, seedUserIfMissing } from "@/app/api/auth/_lib/session";
import { isRawUserId, resolveActorIdentity, roleFallbackLabel } from "@/app/api/_lib/notificationActor";

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

  return { userId, churchId, role, name: u?.email || u?.id || userId };
}

export async function getViewer(req: NextRequest): Promise<Viewer> {
  await seedUserIfMissing();

  const headerUid = String(req.headers.get("x-kristo-user-id") || "").trim();
  const headerRole = String(req.headers.get("x-kristo-role") || "Member").trim();
  const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();

  if (headerUid && (process.env.KRISTO_DEV_HEADER_AUTH === "1" || process.env.NODE_ENV !== "production")) {
    const role = (headerRole as AppRole) || "Member";
    const headerName = String(
      req.headers.get("x-kristo-user-name") ||
        req.headers.get("x-kristo-display-name") ||
        req.headers.get("x-kristo-name") ||
        ""
    ).trim();

    let name = headerName;
    if (!name || isRawUserId(name)) {
      const identity = await resolveActorIdentity(headerUid);
      name = identity.name || roleFallbackLabel(role);
    }

    return { userId: headerUid, name, role, churchId: headerChurchId };
  }

  const dev = await devAutoViewer();
  if (dev) return dev;

  // Mobile sends x-kristo-user-id; readSession(req) resolves it (see session.ts).
  const sess = await readSession(req);
  if (!sess) {
    return { userId: "", name: undefined, role: "Member", churchId: "" };
  }

  const u = await getUserById(sess.userId);
  const profile = await getProfile(sess.userId);
  const profileName = String(profile?.fullName || "").trim();
  const sessionName = profileName || String(u?.email || "").trim();

  return {
    userId: sess.userId,
    name: sessionName || undefined,
    role: (headerRole as AppRole) || "Member",
    churchId: headerChurchId,
  };
}
