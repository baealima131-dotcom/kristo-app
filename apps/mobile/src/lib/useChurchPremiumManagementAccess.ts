import { useEffect, useState } from "react";
import { isMinistryCreationAllowed } from "@/src/components/ChurchPremiumSubscriptionModal";
import { fetchChurchSubscriptionStatus } from "@/src/lib/churchSubscription";
import {
  churchIdsMatch,
  getSeededChurchPremiumAccess,
} from "@/src/lib/churchPremiumAccess";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { onChurchPremiumAccessChanged } from "@/src/lib/kristoProfileEvents";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";

export function useChurchPremiumManagementAccess(churchId: string) {
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(
    isSubscriptionBypassEnabled() ? true : null
  );
  const [canUseMediaTools, setCanUseMediaTools] = useState<boolean | null>(
    isSubscriptionBypassEnabled() ? true : null
  );
  const [ready, setReady] = useState(isSubscriptionBypassEnabled());

  useEffect(() => {
    const resolvedChurchId = String(churchId || "").trim();
    if (!resolvedChurchId) {
      setSubscriptionActive(null);
      setCanUseMediaTools(null);
      setReady(false);
      return;
    }

    if (isSubscriptionBypassEnabled()) {
      setSubscriptionActive(true);
      setCanUseMediaTools(true);
      setReady(true);
      return;
    }

    const seed = getSeededChurchPremiumAccess(resolvedChurchId);
    if (seed) {
      setSubscriptionActive(seed.backendSubscriptionActive ?? seed.subscriptionActive);
      setCanUseMediaTools(seed.canUseMediaTools);
      setReady(true);
    }

    let alive = true;
    fetchChurchSubscriptionStatus(getKristoHeaders(), resolvedChurchId).then((status) => {
      if (!alive) return;
      setSubscriptionActive(status.backendSubscriptionActive ?? status.subscriptionActive);
      setCanUseMediaTools(status.canUseMediaTools ?? null);
      setReady(true);
    });

    return () => {
      alive = false;
    };
  }, [churchId]);

  useEffect(() => {
    const resolvedChurchId = String(churchId || "").trim();
    if (!resolvedChurchId || isSubscriptionBypassEnabled()) return;

    return onChurchPremiumAccessChanged((payload) => {
      if (!churchIdsMatch(payload.churchId, resolvedChurchId)) return;
      setSubscriptionActive(payload.backendSubscriptionActive ?? payload.subscriptionActive);
      setCanUseMediaTools(payload.canUseMediaTools);
      setReady(true);
    });
  }, [churchId]);

  const managementAllowed = isMinistryCreationAllowed(subscriptionActive, canUseMediaTools);

  return {
    subscriptionActive,
    canUseMediaTools,
    ready,
    managementAllowed,
    managementBlocked: !managementAllowed,
  };
}
