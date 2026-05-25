import type { CustomerInfo } from "react-native-purchases";
import type { PlanStatus, SubscriptionPlanKey } from "../../store/paymentsStore";
import {
  getEffectiveSubscriptionState,
  isPlanActive,
} from "./mobileSubscriptions";
import { isSubscriptionBypassEnabled } from "../subscriptionBypass";

export type PremiumGateState = {
  selectedPlan: SubscriptionPlanKey;
  planStatus: PlanStatus;
  hasPremiumAccess: boolean;
};

export function buildPremiumGateState(
  customerInfo: CustomerInfo | null | undefined
): PremiumGateState {
  if (isSubscriptionBypassEnabled()) {
    return {
      selectedPlan: "monthly",
      planStatus: "active",
      hasPremiumAccess: true,
    };
  }

  if (!customerInfo) {
    return {
      selectedPlan: "monthly",
      planStatus: "expired",
      hasPremiumAccess: false,
    };
  }

  const effective = getEffectiveSubscriptionState(customerInfo);
  return {
    ...effective,
    hasPremiumAccess: isPlanActive(effective.selectedPlan, effective.planStatus),
  };
}

export function hasPremiumAccessFromCustomerInfo(
  customerInfo: CustomerInfo | null | undefined
) {
  return buildPremiumGateState(customerInfo).hasPremiumAccess;
}

export function shouldBlockPremiumFeature(
  customerInfo: CustomerInfo | null | undefined
) {
  if (isSubscriptionBypassEnabled()) return false;
  return !hasPremiumAccessFromCustomerInfo(customerInfo);
}
