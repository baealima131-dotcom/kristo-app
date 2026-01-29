// Simple role helper for development.
// TODO: Replace with real role management (DB, Clerk custom claims, or server API).

const ADMIN_IDS = (process.env.KRISTO_ADMIN_IDS || "").split(",").filter(Boolean);

export function getUserRole(userId?: string | null) {
  if (!userId) return "member";
  if (ADMIN_IDS.includes(userId)) return "admin";
  // future logic: check Clerk user metadata or a server-side DB for roles
  return "member";
}
