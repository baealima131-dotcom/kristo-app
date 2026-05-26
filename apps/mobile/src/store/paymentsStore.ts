export type PaymentMainModuleKey =
  | "subscriptions"
  | "donations"
  | "premium_live"
  | "billing";

export type SubscriptionModuleKey = "plans" | "status";
export type DonationModuleKey = "tithes" | "offerings" | "campaigns";
export type PremiumLiveModuleKey = "tickets" | "rooms" | "access";
export type BillingModuleKey = "transactions" | "invoices" | "payouts";

export type PlanStatus = "active" | "expired";
export type GateState = "closed" | "preview" | "open";
export type FinanceStatus = "healthy" | "review" | "delayed";
export type GivingType = "tithe" | "offering" | "support";
export type EventType = "service" | "conference" | "concert";
export type FinanceMode = "transactions" | "invoices" | "payouts";
export type SubscriptionPlanKey = "monthly" | "yearly";
export type PremiumLiveTicketTierKey = "standard" | "vip" | "partner";

export type PaymentsState = {
  currentModule: PaymentMainModuleKey;

  subscriptions: {
    selectedPlan: SubscriptionPlanKey;
    planStatus: PlanStatus;
    activeModule: SubscriptionModuleKey;
  };

  donations: {
    givingType: GivingType;
    selectedAmount: number;
    customAmount: number;
    activeModule: DonationModuleKey;
  };

  premiumLive: {
    eventType: EventType;
    ticketTier: PremiumLiveTicketTierKey;
    gateState: GateState;
    activeModule: PremiumLiveModuleKey;
  };

  billing: {
    financeMode: FinanceMode;
    financeStatus: FinanceStatus;
    activeModule: BillingModuleKey;
  };
};

const listeners = new Set<() => void>();

let state: PaymentsState = {
  currentModule: "subscriptions",

  subscriptions: {
    selectedPlan: "monthly",
    planStatus: "expired",
    activeModule: "plans",
  },

  donations: {
    givingType: "tithe",
    selectedAmount: 50,
    customAmount: 120,
    activeModule: "tithes",
  },

  premiumLive: {
    eventType: "conference",
    ticketTier: "vip",
    gateState: "preview",
    activeModule: "tickets",
  },

  billing: {
    financeMode: "transactions",
    financeStatus: "healthy",
    activeModule: "transactions",
  },
};

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribePayments(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPaymentsState() {
  return state;
}

export function setPaymentsState(
  updater: PaymentsState | ((prev: PaymentsState) => PaymentsState)
) {
  state = typeof updater === "function" ? updater(state) : updater;
  emit();
}

export function updatePaymentsState(patch: Partial<PaymentsState>) {
  state = {
    ...state,
    ...patch,
  };
  emit();
}

export function setPaymentsCurrentModule(currentModule: PaymentMainModuleKey) {
  state = {
    ...state,
    currentModule,
  };
  emit();
}

export function setSubscriptionSelectedPlan(selectedPlan: SubscriptionPlanKey) {
  state = {
    ...state,
    subscriptions: {
      ...state.subscriptions,
      selectedPlan,
    },
  };
  emit();
}

export function setSubscriptionPlanStatus(planStatus: PlanStatus) {
  state = {
    ...state,
    subscriptions: {
      ...state.subscriptions,
      planStatus,
    },
  };
  emit();
}

export function setSubscriptionActiveModule(activeModule: SubscriptionModuleKey) {
  state = {
    ...state,
    subscriptions: {
      ...state.subscriptions,
      activeModule,
    },
  };
  emit();
}

export function setDonationGivingType(givingType: GivingType) {
  state = {
    ...state,
    donations: {
      ...state.donations,
      givingType,
    },
  };
  emit();
}

export function setDonationSelectedAmount(selectedAmount: number) {
  state = {
    ...state,
    donations: {
      ...state.donations,
      selectedAmount,
    },
  };
  emit();
}

export function setDonationCustomAmount(customAmount: number) {
  state = {
    ...state,
    donations: {
      ...state.donations,
      customAmount,
    },
  };
  emit();
}

export function setDonationActiveModule(activeModule: DonationModuleKey) {
  state = {
    ...state,
    donations: {
      ...state.donations,
      activeModule,
    },
  };
  emit();
}

export function setPremiumLiveEventType(eventType: EventType) {
  state = {
    ...state,
    premiumLive: {
      ...state.premiumLive,
      eventType,
    },
  };
  emit();
}

export function setPremiumLiveTicketTier(ticketTier: PremiumLiveTicketTierKey) {
  state = {
    ...state,
    premiumLive: {
      ...state.premiumLive,
      ticketTier,
    },
  };
  emit();
}

export function setPremiumLiveGateState(gateState: GateState) {
  state = {
    ...state,
    premiumLive: {
      ...state.premiumLive,
      gateState,
    },
  };
  emit();
}

export function setPremiumLiveActiveModule(activeModule: PremiumLiveModuleKey) {
  state = {
    ...state,
    premiumLive: {
      ...state.premiumLive,
      activeModule,
    },
  };
  emit();
}

export function setBillingFinanceMode(financeMode: FinanceMode) {
  state = {
    ...state,
    billing: {
      ...state.billing,
      financeMode,
    },
  };
  emit();
}

export function setBillingFinanceStatus(financeStatus: FinanceStatus) {
  state = {
    ...state,
    billing: {
      ...state.billing,
      financeStatus,
    },
  };
  emit();
}

export function setBillingActiveModule(activeModule: BillingModuleKey) {
  state = {
    ...state,
    billing: {
      ...state.billing,
      activeModule,
    },
  };
  emit();
}
