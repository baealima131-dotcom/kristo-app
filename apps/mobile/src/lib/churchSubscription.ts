import { Alert } from "react-native";
import { apiGet, apiPatch } from "./kristoApi";
import { isSubscriptionBypassEnabled, shouldSuppressPremiumPrompts } from "./subscriptionBypass";
export const CHURCH_SUBSCRIPTION_REQUIRED_TITLE = "Subscription required";
export const CHURCH_SUBSCRIPTION_PREMIUM_TITLE = "Premium subscription required";
export const CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE =
  "Subscription required to schedule Live, Media, or Ministry activity.";
export const CHURCH_SUBSCRIPTION_MINISTRY_MESSAGE =
  "Subscription required to create ministries or schedule Live, Media, or Ministry activity.";

export type ChurchSubscriptionRecord = {
  subscriptionActive?: boolean;
  subscriptionPlan?: string;
  subscriptionUpdatedAt?: number;
  subscriptionStatus?: string;
};
export const CHURCH_SUBSCRIPTION_REQUIRED_MESSAGE = CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE;

export function isPastorSessionRole(role?: string) {
  return String(role || "").toLowerCase().includes("pastor");
}

export function isChurchSubscriptionActiveFromRecord(
  record: ChurchSubscriptionRecord | null | undefined
): boolean {
  if (isSubscriptionBypassEnabled()) return true;
  if (record?.subscriptionActive === true) return true;

  const status = String(record?.subscriptionStatus || "")
    .trim()
    .toLowerCase();

  return status === "active" || status === "trialing";
}

export function alertChurchSubscriptionRequired() {
  if (shouldSuppressPremiumPrompts()) return;
  Alert.alert("Subscription required", CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE);
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
    return isChurchSubscriptionActiveFromRecord(res?.media) || Boolean(res?.subscriptionActive);
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
  const error = String(res?.error || res?.message || "").trim();
  const status = Number(res?.status || 0);
  return (
    error === "Subscription required" ||
    status === 403 && error.includes("Subscription") ||
    status === 402 ||
    error.toUpperCase() === "CHURCH_SUBSCRIPTION_REQUIRED"
  );
}

