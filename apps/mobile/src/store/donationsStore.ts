export type DonationModuleKey = "tithes" | "offerings" | "campaigns";
export type GivingType = "tithe" | "offering" | "support";

type DonationsState = {
  givingType: GivingType;
  selectedAmount: number;
  customAmount: number;
  activeModule: DonationModuleKey;
};

type PaymentsState = {
  currentModule: "donations";
  donations: DonationsState;
};

let state: PaymentsState = {
  currentModule: "donations",
  donations: {
    givingType: "tithe",
    selectedAmount: 25,
    customAmount: 25,
    activeModule: "tithes",
  },
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

export function getPaymentsState(): PaymentsState {
  return state;
}

export function subscribePayments(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPaymentsCurrentModule(_module: "donations") {
  state = {
    ...state,
    currentModule: "donations",
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
