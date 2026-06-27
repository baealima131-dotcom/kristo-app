import type { NextRequest } from "next/server";
import { getUserById, readSession, seedUserIfMissing } from "@/app/api/auth/_lib/session";
import { resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";

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

  if (process.env.KRISTO_DEV_HEADER_AUTH === "1") {
    const url = new URL(req.url);

    const qDev = String(url.searchParams.get("devHeaderAuth") || "").trim();
    const headerUid = String(req.headers.get("x-kristo-user-id") || "").trim();
    const headerRole = String(req.headers.get("x-kristo-role") || "Member").trim();
    const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();

    if (headerUid) {
      const role = (headerRole as AppRole) || "Member";
      return { userId: headerUid, name: headerUid, role, churchId: headerChurchId };
    }

    if (process.env.NODE_ENV === "development" && qDev === "1") {
      const userId = process.env.KRISTO_DEV_USER_ID || "u-demo-1";
      const churchId = process.env.KRISTO_DEV_CHURCH_ID || "c-demo-1";
      const role = (process.env.KRISTO_DEV_ROLE as AppRole) || "System_Admin";
      const u = await getUserById(userId);
      return { userId, churchId, role, name: u?.email || u?.id || userId };
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
      name: u?.email || u?.id || resolved.userId,
      role: (headerRole as AppRole) || "Member",
      churchId: headerChurchId,
    };
  }

  // Cookie session fallback (web).
  const sess = await readSession(req);
  if (!sess) {
    return { userId: "", name: undefined, role: "Member", churchId: "" };
  }

  const u = await getUserById(sess.userId);

  return {
    userId: sess.userId,
    name: u?.email,
    role: "Member",
    churchId: "",
  };
}
