import { useEffect, useState } from "react";
import { isMinistryCreationAllowed } from "@/src/components/ChurchPremiumSubscriptionModal";
import { fetchChurchSubscriptionStatus } from "@/src/lib/churchSubscription";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
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

  const managementAllowed = isMinistryCreationAllowed(subscriptionActive, canUseMediaTools);

  return {
    subscriptionActive,
    canUseMediaTools,
    ready,
    managementAllowed,
    managementBlocked: !managementAllowed,
  };
}
