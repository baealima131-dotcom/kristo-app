type PaymentsListener = () => void;

type PaymentsState = {
  subscriptions: {
    selectedPlan: "monthly" | "yearly" | null;
    planStatus: "active" | "inactive" | "trialing" | "cancelled";
  };
};

const defaultState: PaymentsState = {
  subscriptions: {
    selectedPlan: null,
    planStatus: "inactive",
  },
};

const listeners = new Set<PaymentsListener>();

export function getPaymentsState(): PaymentsState {
  return defaultState;
}

export function subscribePayments(listener: PaymentsListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPaymentsState(_next: Partial<PaymentsState>) {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}
