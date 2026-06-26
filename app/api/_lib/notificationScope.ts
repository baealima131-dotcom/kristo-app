import type { AppNotification } from "@/app/api/_lib/notifications";

export type NotificationListScope = "forMe" | "churchAdmin";

/** DB filter scope. `inbox` = legacy overview (NULL target or current user). */
export type NotificationStoreScope = "forMe" | "churchAdmin" | "inbox";

export function canUseChurchAdminScope(role: string): boolean {
  const r = String(role || "").trim();
  return r === "Pastor" || r === "Church_Admin" || r === "System_Admin";
}

export function resolveNotificationScope(
  scopeParam: string | null,
  role: string,
  opts?: { allParam?: string | null }
): { scope: NotificationListScope; storeScope: NotificationStoreScope } {
  const all = opts?.allParam === "1" || opts?.allParam === "true";
  const requested = scopeParam === "churchAdmin" || all ? "churchAdmin" : "forMe";
  if (requested === "churchAdmin" && canUseChurchAdminScope(role)) {
    return { scope: "churchAdmin", storeScope: "churchAdmin" };
  }
  return { scope: "forMe", storeScope: "forMe" };
}

export function matchesNotificationStoreScope(
  n: AppNotification,
  userId: string,
  storeScope: NotificationStoreScope
): boolean {
  const target = String(n.targetUserId || "").trim();
  if (storeScope === "forMe") return target === userId;
  if (storeScope === "churchAdmin") return !target;
  return !target || target === userId;
}

export function canViewerMarkNotification(
  n: AppNotification,
  userId: string,
  role: string
): boolean {
  const target = String(n.targetUserId || "").trim();
  if (target && target !== userId) return false;
  if (!target) return canUseChurchAdminScope(role);
  return true;
}
