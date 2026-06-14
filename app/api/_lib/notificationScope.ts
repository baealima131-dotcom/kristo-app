export type NotificationListScope = "forMe" | "churchAdmin";

const ADMIN_ROLES = new Set(["Pastor", "Church_Admin", "System_Admin"]);

export function canUseChurchAdminNotificationScope(role: string): boolean {
  return ADMIN_ROLES.has(String(role || "").trim());
}

export function parseNotificationListScope(
  raw: string | null | undefined,
  role: string
): NotificationListScope {
  const scope = String(raw || "forMe").trim().toLowerCase();
  if (scope === "churchadmin" || scope === "church_admin" || scope === "admin") {
    return canUseChurchAdminNotificationScope(role) ? "churchAdmin" : "forMe";
  }
  return "forMe";
}

export function scopeToIncludeAllTargets(scope: NotificationListScope): boolean {
  return scope === "churchAdmin";
}
