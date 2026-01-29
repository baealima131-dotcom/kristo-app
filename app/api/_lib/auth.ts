import type { NextRequest } from "next/server";
import { getUserById, readSession, seedUserIfMissing } from "@/app/api/auth/_lib/session";

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

/* =========================
   DEV AUTO LOGIN (NO SIGN-IN)
   - Only works in development
   - OFF by default unless KRISTO_DEV_AUTO_LOGIN=1
   ========================= */
function devAutoViewer(): Viewer | null {
  if (process.env.NODE_ENV !== "development") return null;
  if (process.env.KRISTO_DEV_AUTO_LOGIN !== "1") return null;

  const userId = process.env.KRISTO_DEV_USER_ID || "u-demo-1";
  const churchId = process.env.KRISTO_DEV_CHURCH_ID || "church-dev-1";
  const role = (process.env.KRISTO_DEV_ROLE as AppRole) || "Member";
  const u = getUserById(userId);

  return { userId, churchId, role, name: u?.email || u?.id || userId };
}

/**
 * getViewer (Kristo session cookie based)
 * - userId: from kristo_session
 * - role/churchId: resolved later by rbac.ts (defaults here)
 *
 * DEV ONLY (optional):
 * - If KRISTO_DEV_HEADER_AUTH=1, allow impersonation via headers:
 *   x-kristo-user-id, x-kristo-role, x-kristo-church-id
 */
export async function getViewer(req: NextRequest): Promise<Viewer> {
  seedUserIfMissing();

  // DEV ONLY: allow curl tests without cookies (when header is provided)
  if (process.env.KRISTO_DEV_HEADER_AUTH === "1") {
    const uid = String(req.headers.get("x-kristo-user-id") || "").trim();
    if (uid) {
      const role = (String(req.headers.get("x-kristo-role") || "Member").trim() as AppRole) || "Member";
      const churchId = String(req.headers.get("x-kristo-church-id") || "").trim();
      return { userId: uid, name: uid, role, churchId };
    }
  }

  // DEV ONLY: auto login (skip sign-in) for local dev
  const dev = devAutoViewer();
  if (dev) return dev;

  const sess = await readSession();
  if (!sess) {
    return { userId: "", name: undefined, role: "Member", churchId: "" };
  }

  const u = getUserById(sess.userId);

  return {
    userId: sess.userId,
    name: u?.email,
    role: "Member",
    churchId: "",
  };
}
