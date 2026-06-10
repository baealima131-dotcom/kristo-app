export type ChurchSubscriptionRecord = {
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
};

export const CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE =
  "Subscription required to schedule Live, Media, or Ministry activity.";

export const CHURCH_SUBSCRIPTION_REQUIRED_TITLE = "Church Subscription Required";

export const CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE = CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE;

export function isChurchSubscriptionActiveFromRecord(
  record: ChurchSubscriptionRecord | null | undefined
): boolean {
  if (record?.subscriptionActive === true) return true;

  const status = String((record as { subscriptionStatus?: string } | null)?.subscriptionStatus || "")
    .trim()
    .toLowerCase();

  return status === "active" || status === "trialing";
}

export function logSubscriptionGateBlocked(
  gate: string,
  churchSubscriptionActive: boolean | null,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_SUBSCRIPTION_GATE_BLOCKED", {
    gate,
    churchSubscriptionActive,
    ...(extra || {}),
  });
}
