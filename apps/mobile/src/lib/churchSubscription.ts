import { Alert } from "react-native";
import { apiGet, apiPatch } from "./kristoApi";
import { getSessionSync } from "./kristoSession";
import {
  isScheduleSubscriptionBypassEnabled,
  isSubscriptionBypassEnabled,
  shouldSuppressPremiumPrompts,
} from "./subscriptionBypass";

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

export type ScheduleGateLogContext = {
  screen: string;
  gate: string;
  isPastor?: boolean;
  hasSubscription?: boolean | null;
  subscriptionLocked?: boolean | null;
  headers?: Record<string, string>;
};

export function isPastorSessionRole(role?: string) {
  return String(role || "").toLowerCase().includes("pastor");
}

export function resolveScheduleGateIsPastor(
  opts?: { isPastor?: boolean },
  headers?: Record<string, string>
) {
  if (opts?.isPastor === true) return true;

  const session = getSessionSync() as any;
  const headerRole = String(
    headers?.["x-kristo-role"] || headers?.["X-Kristo-Role"] || ""
  )
    .trim()
    .toLowerCase();
  const sessionRole = String(session?.role || "").trim().toLowerCase();
  const churchRole = String(session?.churchRole || "").trim().toLowerCase();

  return (
    headerRole.includes("pastor") ||
    headerRole.includes("admin") ||
    sessionRole.includes("pastor") ||
    sessionRole.includes("admin") ||
    churchRole === "pastor" ||
    churchRole === "church_admin"
  );
}

export function isScheduleSubscriptionGateBypassed(
  opts?: { isPastor?: boolean },
  headers?: Record<string, string>
) {
  const isPastor = resolveScheduleGateIsPastor(opts, headers);
  if (isSubscriptionBypassEnabled()) {
    return { bypassed: true, isPastor };
  }
  if (isScheduleSubscriptionBypassEnabled(isPastor)) {
    return { bypassed: true, isPastor };
  }
  return { bypassed: false, isPastor };
}

function logScheduleGate(meta: {
  kind: "check" | "bypassed" | "blocked";
  screen: string;
  gate: string;
  isPastor: boolean;
  bypassEnabled: boolean;
  hasSubscription?: boolean | null;
  subscriptionLocked?: boolean | null;
  allowed: boolean;
}) {
  const payload = {
    screen: meta.screen,
    gate: meta.gate,
    isPastor: meta.isPastor,
    bypassEnabled: meta.bypassEnabled,
    hasSubscription: meta.hasSubscription ?? null,
    subscriptionLocked: meta.subscriptionLocked ?? null,
    allowed: meta.allowed,
  };

  if (meta.kind === "check") {
    console.log("KRISTO_SCHEDULE_GATE_CHECK", payload);
    return;
  }
  if (meta.kind === "bypassed") {
    console.log("KRISTO_SCHEDULE_GATE_BYPASSED", payload);
    return;
  }
  console.log("KRISTO_SCHEDULE_GATE_BLOCKED", payload);
}

export function evaluateScheduleSubscriptionGate(ctx: ScheduleGateLogContext) {
  const isPastor = resolveScheduleGateIsPastor({ isPastor: ctx.isPastor }, ctx.headers);
  const { bypassed } = isScheduleSubscriptionGateBypassed({ isPastor }, ctx.headers);
  const churchMediaActive =
    ctx.hasSubscription === true || ctx.subscriptionLocked === false;
  const allowed = bypassed || churchMediaActive;

  logScheduleGate({
    kind: "check",
    screen: ctx.screen,
    gate: ctx.gate,
    isPastor,
    bypassEnabled: bypassed,
    hasSubscription: ctx.hasSubscription ?? null,
    subscriptionLocked: ctx.subscriptionLocked ?? null,
    allowed,
  });

  if (bypassed) {
    logScheduleGate({
      kind: "bypassed",
      screen: ctx.screen,
      gate: ctx.gate,
      isPastor,
      bypassEnabled: true,
      hasSubscription: ctx.hasSubscription ?? null,
      subscriptionLocked: ctx.subscriptionLocked ?? null,
      allowed: true,
    });
  } else if (!allowed) {
    logScheduleGate({
      kind: "blocked",
      screen: ctx.screen,
      gate: ctx.gate,
      isPastor,
      bypassEnabled: false,
      hasSubscription: ctx.hasSubscription ?? null,
      subscriptionLocked: ctx.subscriptionLocked ?? null,
      allowed: false,
    });
  }

  return { allowed, isPastor, bypassEnabled: bypassed };
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

export function alertChurchSubscriptionRequired(opts?: {
  isPastor?: boolean;
  screen?: string;
  gate?: string;
}) {
  const isPastor = resolveScheduleGateIsPastor(opts);
  const { bypassed } = isScheduleSubscriptionGateBypassed({ isPastor });

  if (shouldSuppressPremiumPrompts() || bypassed) {
    logScheduleGate({
      kind: "bypassed",
      screen: String(opts?.screen || "alertChurchSubscriptionRequired"),
      gate: String(opts?.gate || "alertChurchSubscriptionRequired"),
      isPastor,
      bypassEnabled: true,
      allowed: true,
    });
    return;
  }

  logScheduleGate({
    kind: "blocked",
    screen: String(opts?.screen || "alertChurchSubscriptionRequired"),
    gate: String(opts?.gate || "alertChurchSubscriptionRequired"),
    isPastor,
    bypassEnabled: false,
    allowed: false,
  });

  Alert.alert("Subscription required", CHURCH_SUBSCRIPTION_SCHEDULE_MESSAGE);
}

export async function fetchChurchSubscriptionActive(
  churchId: string,
  headers?: Record<string, string>
): Promise<boolean> {
  const { bypassed } = isScheduleSubscriptionGateBypassed({}, headers);
  if (isSubscriptionBypassEnabled() || bypassed) return true;

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
  headers?: Record<string, string>,
  opts?: { isPastor?: boolean; screen?: string; gate?: string }
) {
  const screen = String(opts?.screen || "requireActiveChurchSubscriptionForSchedule");
  const gate = String(opts?.gate || "requireActiveChurchSubscriptionForSchedule");
  const isPastor = resolveScheduleGateIsPastor(opts, headers);
  const { bypassed } = isScheduleSubscriptionGateBypassed({ isPastor }, headers);

  if (bypassed) {
    logScheduleGate({
      kind: "check",
      screen,
      gate,
      isPastor,
      bypassEnabled: true,
      allowed: true,
    });
    logScheduleGate({
      kind: "bypassed",
      screen,
      gate,
      isPastor,
      bypassEnabled: true,
      allowed: true,
    });
    return true;
  }

  const active = await fetchChurchSubscriptionActive(churchId, headers);

  logScheduleGate({
    kind: "check",
    screen,
    gate,
    isPastor,
    bypassEnabled: false,
    hasSubscription: active,
    allowed: active,
  });

  if (!active) {
    logScheduleGate({
      kind: "blocked",
      screen,
      gate,
      isPastor,
      bypassEnabled: false,
      hasSubscription: false,
      allowed: false,
    });
    alertChurchSubscriptionRequired({ isPastor, screen, gate });
  }

  return active;
}

export function isChurchSubscriptionRequiredError(
  res: any,
  opts?: { isPastor?: boolean; screen?: string; gate?: string }
) {
  const isPastor = resolveScheduleGateIsPastor(opts);
  const { bypassed } = isScheduleSubscriptionGateBypassed({ isPastor });

  if (isSubscriptionBypassEnabled() || bypassed) {
    logScheduleGate({
      kind: "bypassed",
      screen: String(opts?.screen || "isChurchSubscriptionRequiredError"),
      gate: String(opts?.gate || "isChurchSubscriptionRequiredError"),
      isPastor,
      bypassEnabled: true,
      allowed: true,
    });
    return false;
  }

  const error = String(res?.error || res?.message || "").trim();
  const status = Number(res?.status || 0);
  const blocked =
    error === "Subscription required" ||
    (status === 403 && error.includes("Subscription")) ||
    status === 402 ||
    error.toUpperCase() === "CHURCH_SUBSCRIPTION_REQUIRED";

  if (blocked) {
    logScheduleGate({
      kind: "blocked",
      screen: String(opts?.screen || "isChurchSubscriptionRequiredError"),
      gate: String(opts?.gate || "isChurchSubscriptionRequiredError"),
      isPastor,
      bypassEnabled: false,
      allowed: false,
    });
  }

  return blocked;
}
