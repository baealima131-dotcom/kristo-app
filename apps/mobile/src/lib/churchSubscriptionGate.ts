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
  viewerIsHost?: boolean;
  canUseMediaTools?: boolean;
  canOpenMediaScreen?: boolean;
  ministryRole?: string;
  ministryToolAllowed?: boolean;
  toolKey?: string;
  /** When true, only pastors pass the role check (e.g. subscription activation). */
  pastorOnly?: boolean;
};

function isMinistryLeaderRole(ministryRole?: string) {
  const role = String(ministryRole || "").trim().toLowerCase();
  return (
    role.includes("leader") ||
    role.includes("ministry_leader") ||
    role.includes("admin") ||
    role.includes("assistant")
  );
}

function isAssignmentToolGate(gate: string) {
  return String(gate || "").trim().startsWith("assignment-tool.");
}

function resolveStrictGateRoleAllowed(ctx: StrictChurchMediaLiveGateContext, gate: string) {
  if (ctx.isPastor) return true;
  if (ctx.isApprovedMediaHost || ctx.viewerIsHost === true) return true;
  if (ctx.canUseMediaTools === true) return true;
  if (ctx.canOpenMediaScreen === true) return true;

  const toolKey = String(ctx.toolKey || "").trim().toLowerCase();
  const isMinistryScheduleTool =
    toolKey === "meeting" || toolKey === "schedule" || isAssignmentToolGate(gate);

  if (isMinistryScheduleTool) {
    if (ctx.ministryToolAllowed === true) return true;
    if (isMinistryLeaderRole(ctx.ministryRole)) return true;
    return false;
  }

  return false;
}

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
  const viewerIsHost = ctx.viewerIsHost === true;

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
      viewerIsHost,
      ministryRole: ctx.ministryRole || null,
      ministryToolAllowed: ctx.ministryToolAllowed ?? null,
    });
    return { allowed: false, reason: "subscription_inactive" };
  }

  if (!resolveStrictGateRoleAllowed(ctx, gate)) {
    logSubscriptionGateBlocked(gate, churchSubscriptionActive, {
      screen: ctx.screen || null,
      reason: "not_media_role",
      isPastor,
      isApprovedMediaHost,
      viewerIsHost,
      canUseMediaTools: ctx.canUseMediaTools ?? null,
      canOpenMediaScreen: ctx.canOpenMediaScreen ?? null,
      ministryRole: ctx.ministryRole || null,
      ministryToolAllowed: ctx.ministryToolAllowed ?? null,
      toolKey: ctx.toolKey || null,
    });
    return { allowed: false, reason: "not_media_role" };
  }

  return { allowed: true, reason: "church_active" };
}
