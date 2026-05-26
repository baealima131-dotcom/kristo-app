export type ChurchSubscriptionRecord = {
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
};

export const CHURCH_SUBSCRIPTION_REQUIRED_TITLE = "Church Subscription Required";

export const CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE =
  "Only the Pastor can activate the church subscription. Media hosts and ministry leaders cannot create schedules until the church subscription is active.";

export function isChurchSubscriptionActiveFromRecord(
  record: ChurchSubscriptionRecord | null | undefined
): boolean {
  return Boolean(record?.subscriptionActive);
}
