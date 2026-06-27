export type OfflineActivationRole = "System_Admin" | "Supervisor" | "Agent";

export type OfflineActivationRoute = "system-admin" | "supervisor" | "agent";

export type OfflineActivationMoreItem = {
  key: string;
  title: string;
  sub: string;
  iconLib: "ion" | "mci";
  icon: string;
  href: string;
  requiredRole: OfflineActivationRole;
};

const OFFLINE_ACTIVATION_MORE_ITEMS: OfflineActivationMoreItem[] = [
  {
    key: "system_admin",
    title: "System Admin",
    sub: "Full platform control • activation codes",
    iconLib: "ion",
    icon: "shield-checkmark",
    href: "/more/system-admin",
    requiredRole: "System_Admin",
  },
  {
    key: "supervisor",
    title: "Supervisor",
    sub: "Manage agents • distribute codes",
    iconLib: "ion",
    icon: "people-circle",
    href: "/more/supervisor",
    requiredRole: "Supervisor",
  },
  {
    key: "agent",
    title: "Agent",
    sub: "Deliver codes • church activation",
    iconLib: "ion",
    icon: "ticket-outline",
    href: "/more/agent",
    requiredRole: "Agent",
  },
];

export function normalizeOfflineActivationRole(role: string): OfflineActivationRole | null {
  const normalized = String(role || "").trim();
  if (normalized === "System_Admin") return "System_Admin";
  if (normalized === "Supervisor") return "Supervisor";
  if (normalized === "Agent") return "Agent";
  return null;
}

export function hasOfflineActivationRole(
  role: string,
  requiredRole: OfflineActivationRole
): boolean {
  return normalizeOfflineActivationRole(role) === requiredRole;
}

export function getOfflineActivationMoreItems(platformRole: string): OfflineActivationMoreItem[] {
  const normalized = normalizeOfflineActivationRole(platformRole);
  if (!normalized) return [];
  return OFFLINE_ACTIVATION_MORE_ITEMS.filter((item) => item.requiredRole === normalized);
}

export function logOfflineActivationMoreCardVisibility(platformRole: string, userId: string) {
  const normalized = normalizeOfflineActivationRole(platformRole);
  console.log("KRISTO_MORE_OFFLINE_ROLE", {
    platformRole: normalized,
    userId: String(userId || "").trim() || null,
  });

  const base = { role: normalized, userId: String(userId || "").trim() || null };

  if (normalized === "System_Admin") {
    console.log("KRISTO_MORE_ADMIN_CARD_VISIBLE", base);
    return;
  }
  if (normalized === "Supervisor") {
    console.log("KRISTO_MORE_SUPERVISOR_CARD_VISIBLE", base);
    return;
  }
  if (normalized === "Agent") {
    console.log("KRISTO_MORE_AGENT_CARD_VISIBLE", base);
  }
}

export function logOfflineCodesRouteOpened(
  route: OfflineActivationRoute,
  role: string,
  userId?: string
) {
  console.log("KRISTO_OFFLINE_CODES_ROUTE_OPENED", {
    route,
    role: normalizeOfflineActivationRole(role) || String(role || "").trim() || null,
    userId: String(userId || "").trim() || null,
  });
}
