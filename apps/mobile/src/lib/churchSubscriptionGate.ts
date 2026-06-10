const loggedBlockedGates = new Set<string>();

export function logSubscriptionGateBlocked(
  gate: string,
  churchSubscriptionActive: boolean | null,
  extra?: Record<string, unknown>
) {
  const key = `${gate}:${churchSubscriptionActive}:${JSON.stringify(extra || {})}`;
  if (loggedBlockedGates.has(key)) return;
  loggedBlockedGates.add(key);
  console.log("KRISTO_SUBSCRIPTION_GATE_BLOCKED", {
    gate,
    churchSubscriptionActive,
    ...(extra || {}),
  });
}

export function isStrictChurchSubscriptionActive(
  churchSubscriptionActive: boolean | null | undefined
): churchSubscriptionActive is true {
  return churchSubscriptionActive === true;
}

export type StrictChurchMediaLiveGateContext = {
  gate: string;
  screen?: string;
  churchId?: string;
  churchSubscriptionActive: boolean | null;
  isPastor?: boolean;
  isApprovedMediaHost?: boolean;
  /** When true, only pastors pass the role check (e.g. subscription activation). */
  pastorOnly?: boolean;
};

/**
 * V1 media/live gates: always require real churchSubscriptionActive === true.
 * Dev/review subscription bypass env vars must not unlock these gates.
 */
export function evaluateStrictChurchMediaLiveSubscriptionGate(
  ctx: StrictChurchMediaLiveGateContext
): { allowed: boolean; reason: string } {
  const gate = String(ctx.gate || "unknown");
  const churchSubscriptionActive = ctx.churchSubscriptionActive ?? null;
  const isPastor = ctx.isPastor === true;
  const isApprovedMediaHost = ctx.isApprovedMediaHost === true;

  if (ctx.pastorOnly && !isPastor) {
    logSubscriptionGateBlocked(gate, churchSubscriptionActive, {
      screen: ctx.screen || null,
      reason: "pastor_only",
    });
    return { allowed: false, reason: "pastor_only" };
  }

  if (!isStrictChurchSubscriptionActive(churchSubscriptionActive)) {
    logSubscriptionGateBlocked(gate, churchSubscriptionActive, {
      screen: ctx.screen || null,
      churchId: ctx.churchId || null,
      isPastor,
      isApprovedMediaHost,
    });
    return { allowed: false, reason: "subscription_inactive" };
  }

  if (!isPastor && !isApprovedMediaHost) {
    logSubscriptionGateBlocked(gate, churchSubscriptionActive, {
      screen: ctx.screen || null,
      reason: "not_media_role",
    });
    return { allowed: false, reason: "not_media_role" };
  }

  return { allowed: true, reason: "church_active" };
}
