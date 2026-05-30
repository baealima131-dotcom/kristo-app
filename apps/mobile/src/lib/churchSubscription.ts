import { Alert } from "react-native";

import { apiGet } from "@/src/lib/kristoApi";

export const CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE =
  "Subscription required to schedule Live, Media, or Ministry activity.";

export function isChurchSubscriptionRequiredError(res: unknown) {
  if (!res || typeof res !== "object") return false;

  const row = res as Record<string, unknown>;
  const error = String(row.error || row.message || "").trim();
  const status = Number(row.status || 0);

  return error === "Subscription required" || (status === 403 && error.includes("Subscription"));
}

export function alertChurchSubscriptionRequired() {
  Alert.alert("Subscription required", CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE);
}

export async function fetchChurchSubscriptionActive(
  churchId: string,
  headers: Record<string, string>
) {
  const id = String(churchId || "").trim();
  if (!id) return false;

  const res: any = await apiGet("/api/church/media", { headers }).catch(() => null);
  if (!res?.ok) return false;

  return Boolean(
    res?.subscriptionActive ||
      res?.media?.subscriptionActive ||
      String(res?.media?.subscriptionStatus || "").trim().toLowerCase() === "active"
  );
}

export async function requireActiveChurchSubscriptionForSchedule(
  churchId: string,
  headers: Record<string, string>
) {
  const active = await fetchChurchSubscriptionActive(churchId, headers);
  if (active) return true;

  alertChurchSubscriptionRequired();
  return false;
}
