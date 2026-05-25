import { Alert } from "react-native";
import { apiGet, apiPatch } from "./kristoApi";
import { isSubscriptionBypassEnabled, shouldSuppressPremiumPrompts } from "./subscriptionBypass";

export type ChurchSubscriptionRecord = {
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
};

export const CHURCH_SUBSCRIPTION_REQUIRED_TITLE = "Church Subscription Required";

export const CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE =
  "Only the Pastor can activate the church subscription. Media hosts and ministry leaders cannot create schedules until the church subscription is active.";

export function isPastorSessionRole(role?: string) {
  return String(role || "").toLowerCase().includes("pastor");
}

export function isChurchSubscriptionActiveFromRecord(
  record: ChurchSubscriptionRecord | null | undefined
): boolean {
  if (isSubscriptionBypassEnabled()) return true;
  return Boolean(record?.subscriptionActive);
}

export function alertChurchSubscriptionRequired() {
  if (shouldSuppressPremiumPrompts()) return;
  Alert.alert(CHURCH_SUBSCRIPTION_REQUIRED_TITLE, CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE);
}

export async function fetchChurchSubscriptionActive(
  churchId: string,
  headers?: Record<string, string>
): Promise<boolean> {
  if (isSubscriptionBypassEnabled()) return true;
  const cid = String(churchId || "").trim();
  if (!cid) return false;

  try {
    const res: any = await apiGet("/api/church/media", {
      headers,
      cache: "no-store",
    });
    return isChurchSubscriptionActiveFromRecord(res?.media);
  } catch {
    return false;
  }
}

export async function activateChurchSubscriptionForPastor(
  churchId: string,
  subscriptionPlan: "monthly" | "yearly",
  headers?: Record<string, string>
): Promise<boolean> {
  const cid = String(churchId || "").trim();
  if (!cid) return false;

  try {
    const res: any = await apiPatch(
      "/api/church/media",
      {
        action: "activate_church_subscription",
        subscriptionPlan,
        subscriptionActive: true,
      },
      { headers }
    );
    return Boolean(res?.ok && res?.media?.subscriptionActive);
  } catch {
    return false;
  }
}

export async function requireActiveChurchSubscriptionForSchedule(
  churchId: string,
  headers?: Record<string, string>
): Promise<boolean> {
  if (isSubscriptionBypassEnabled()) return true;
  const active = await fetchChurchSubscriptionActive(churchId, headers);
  if (!active) {
    alertChurchSubscriptionRequired();
  }
  return active;
}

export function isChurchSubscriptionRequiredError(res: any): boolean {
  if (isSubscriptionBypassEnabled()) return false;
  return (
    Number(res?.status || 0) === 402 ||
    String(res?.error || "").toUpperCase() === "CHURCH_SUBSCRIPTION_REQUIRED"
  );
}

