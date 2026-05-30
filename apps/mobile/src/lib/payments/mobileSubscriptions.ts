export type SubscriptionPlan = "monthly" | "yearly" | null;
export type SubscriptionStatus = "active" | "inactive" | "trialing" | "cancelled";

export function isPlanActive(plan: SubscriptionPlan, status: SubscriptionStatus | string | null | undefined) {
  return String(status || "").trim().toLowerCase() === "active" && Boolean(plan);
}
