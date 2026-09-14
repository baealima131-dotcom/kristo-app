export const SOKO_SESSION_EXPIRED_MESSAGE =
  "Your Kristo session expired. Sign in again to continue checkout.";

export const KRISTO_SESSION_REISSUE_MESSAGE =
  "Your Kristo session could not be verified. Sign in once to continue checkout.";

export const CHECKOUT_AUTH_MISMATCH_MESSAGE =
  "Delivery authorization could not be completed. Try again.";

export const SOKO_SESSION_NOT_RENEWED_MESSAGE =
  "Kristo session was not renewed. Sign in again.";

export const CHECKOUT_REAUTH_CANCELLED_MESSAGE =
  "Sign-in cancelled. Your checkout details were kept.";

export const CHECKOUT_RECONNECT_CANCELLED_MESSAGE =
  "Reconnect cancelled. Your checkout details were kept.";

export type CheckoutDeliveryFailureKind = "session_expired" | "retryable";

export type CheckoutAuthSource = "home-checkout" | "soko-standalone";

export type CheckoutAuthPhase =
  | "required"
  | "started"
  | "succeeded"
  | "cancelled"
  | "resumed";

export type CheckoutDraft = {
  productId: string;
  quantity: number;
  delivery: {
    fullName: string;
    phone: string;
    country: string;
    state: string;
    city: string;
    streetAddress: string;
    apartment: string;
    postalCode: string;
    instructions: string;
  };
  paymentMethod: string;
  step: string;
  variant: string;
};

function text(value: unknown) {
  return String(value || "").trim();
}

export function evaluateSessionRenewal(input: {
  blockedToken: string;
  nextToken: string;
}) {
  const blocked = text(input.blockedToken);
  const next = text(input.nextToken);
  const accepted = Boolean(blocked) && Boolean(next) && blocked !== next;
  return {
    accepted,
    tokenChanged: accepted,
    reason: accepted ? ("renewed" as const) : ("unchanged_token" as const),
  };
}

export function isLiveCheckoutUnauthorized(input: {
  status?: number;
  error?: unknown;
  details?: { hint?: unknown; code?: unknown } | null;
  message?: unknown;
  code?: unknown;
}) {
  const status = Number(input?.status || 0);
  const error = text(input?.error).toLowerCase();
  const hint = text(input?.details?.hint).toLowerCase().replace(/\.$/, "");
  const message = text(input?.message).toLowerCase().replace(/\.$/, "");
  return (
    status === 401 ||
    error === "unauthorized" ||
    message === "unauthorized" ||
    hint === "you must be signed in" ||
    message === "you must be signed in" ||
    error === "you must be signed in"
  );
}

export function checkoutAuthFailureReason(input: {
  details?: { reason?: unknown } | null;
  reason?: unknown;
}) {
  return text(input?.details?.reason || input?.reason || "");
}

export function checkoutAuthFailureCode(input: {
  details?: { code?: unknown } | null;
  code?: unknown;
  debug?: { code?: unknown } | null;
}) {
  return text(
    input?.details?.code || input?.code || input?.debug?.code || ""
  );
}

export function isUnverifiableCheckoutToken(input: {
  details?: { reason?: unknown; code?: unknown } | null;
  reason?: unknown;
}) {
  const reason = checkoutAuthFailureReason(input);
  return (
    reason === "bad-signature" ||
    reason === "malformed" ||
    reason === "no-secret" ||
    reason === "bad-payload" ||
    reason === "bad-issuer" ||
    reason === "unsupported-version"
  );
}

export function isCheckoutPermissionFailure(error: unknown) {
  const row =
    error && typeof error === "object"
      ? (error as {
          status?: number;
          code?: unknown;
          details?: { code?: unknown };
        })
      : {};
  const code = checkoutAuthFailureCode(row).toUpperCase();
  const status = Number(row.status || 0);
  return (
    status === 403 ||
    code.startsWith("SAFETY_") ||
    code === "FORBIDDEN"
  );
}

export function isCheckoutSessionExpiredFailure(error: unknown) {
  const message = text((error as Error)?.message || error);
  if (message === CHECKOUT_AUTH_MISMATCH_MESSAGE) return false;
  if (isCheckoutPermissionFailure(error)) return false;
  if (
    message === SOKO_SESSION_EXPIRED_MESSAGE ||
    message === KRISTO_SESSION_REISSUE_MESSAGE ||
    message.startsWith("Your Kristo session expired") ||
    message.startsWith("Your Kristo session could not be verified")
  ) {
    return true;
  }
  if (error && typeof error === "object") {
    const row = error as {
      status?: number;
      error?: unknown;
      details?: { hint?: unknown; code?: unknown; reason?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const code = checkoutAuthFailureCode(row).toUpperCase();
    if (code === "CHECKOUT_AUTH_MISMATCH") return false;
    if (isUnverifiableCheckoutToken(row)) return true;
    if (
      code === "CHECKOUT_SESSION_EXPIRED" ||
      code === "CHECKOUT_UNAUTHENTICATED"
    ) {
      return true;
    }
  }
  return false;
}

export function classifyCheckoutDeliveryFailure(
  error: unknown
): CheckoutDeliveryFailureKind {
  return isCheckoutSessionExpiredFailure(error)
    ? "session_expired"
    : "retryable";
}

export function checkoutAuthLifecycleEvent(
  source: CheckoutAuthSource,
  phase: CheckoutAuthPhase
) {
  if (source === "soko-standalone") {
    return {
      required: "CHECKOUT_RECONNECT_REQUIRED",
      started: "RECONNECT_STARTED",
      succeeded: "RECONNECT_SUCCEEDED",
      cancelled: "RECONNECT_CANCELLED",
      resumed: "DELIVERY_RATES_RESUMED",
    }[phase];
  }
  return {
    required: "CHECKOUT_REAUTH_REQUIRED",
    started: "REAUTH_STARTED",
    succeeded: "REAUTH_SUCCEEDED",
    cancelled: "REAUTH_CANCELLED",
    resumed: "DELIVERY_RATES_RESUMED",
  }[phase];
}

export function logCheckoutAuthEvent(
  source: CheckoutAuthSource,
  phase: CheckoutAuthPhase,
  input: {
    path?: string;
    status?: number;
    reason?: string;
    quarantined?: boolean;
    tokenChanged?: boolean;
    restoredDraft?: boolean;
    once?: boolean;
    hasSessionToken?: boolean;
    hasUserId?: boolean;
  } = {}
) {
  console.log(checkoutAuthLifecycleEvent(source, phase), {
    path: input.path ? String(input.path).split("?")[0] : undefined,
    status:
      input.status === undefined || input.status === null
        ? undefined
        : Number(input.status),
    reason: input.reason || undefined,
    quarantined: input.quarantined === true,
    tokenChanged: input.tokenChanged === true,
    restoredDraft: input.restoredDraft === true,
    once: input.once === true,
    source,
    hasSessionToken: input.hasSessionToken === true,
    hasUserId: input.hasUserId === true,
  });
}

export function sellerAccessAllowedFor(
  reason: "seller-orders" | "buyer-checkout"
) {
  return reason === "seller-orders";
}

export function checkoutAuthPresentation(input: {
  source: "home-checkout" | "soko-standalone" | "seller-orders";
  role?: string;
}) {
  void text(input.role);
  if (input.source === "seller-orders") {
    return {
      route: "seller-access" as const,
      primaryAction: "Reconnect Kristo Account" as const,
      lifecycle: "reconnect" as const,
      usesSellerAccess: true,
    };
  }
  if (input.source === "soko-standalone") {
    return {
      route: "soko-kristo-bridge" as const,
      primaryAction: "Reconnect Kristo Account" as const,
      lifecycle: "reconnect" as const,
      usesSellerAccess: false,
    };
  }
  return {
    route: "kristo-member-auth" as const,
    primaryAction: "Sign in again to continue checkout" as const,
    lifecycle: "reauth" as const,
    usesSellerAccess: false,
  };
}

export function checkoutDeliveryRecoveryActions(
  kind: CheckoutDeliveryFailureKind | "",
  source: CheckoutAuthSource = "home-checkout"
) {
  if (kind === "session_expired") {
    const presentation = checkoutAuthPresentation({ source });
    return {
      primaryAction: presentation.primaryAction,
      showRetry: false,
      route: presentation.route,
    };
  }
  return {
    primaryAction: "Retry" as const,
    showRetry: true,
    route: "none" as const,
  };
}

export function snapshotCheckoutDraft(
  input: Partial<CheckoutDraft> & {
    delivery?: Partial<CheckoutDraft["delivery"]> | null;
  }
): CheckoutDraft {
  const delivery: Partial<CheckoutDraft["delivery"]> = input.delivery || {};
  return {
    productId: text(input.productId),
    quantity: Math.max(1, Number(input.quantity) || 1),
    variant: text(input.variant),
    delivery: {
      fullName: text(delivery.fullName),
      phone: text(delivery.phone),
      country: text(delivery.country) || "United States",
      state: text(delivery.state),
      city: text(delivery.city),
      streetAddress: text(delivery.streetAddress),
      apartment: text(delivery.apartment),
      postalCode: text(delivery.postalCode),
      instructions: text(delivery.instructions),
    },
    paymentMethod: text(input.paymentMethod),
    step: text(input.step) || "choose_delivery",
  };
}

export function restoreCheckoutDraft(
  draft: Partial<CheckoutDraft> | null | undefined
): CheckoutDraft | null {
  if (!text(draft?.productId)) return null;
  return snapshotCheckoutDraft(draft || {});
}

export function checkoutRequestAllowedWhileReconnecting(reconnecting: boolean) {
  return reconnecting !== true;
}

export function checkoutAfterSessionRenewed(input: {
  draft: CheckoutDraft;
  blockedToken: string;
  nextToken: string;
}) {
  const renewal = evaluateSessionRenewal({
    blockedToken: input.blockedToken,
    nextToken: input.nextToken,
  });
  return {
    restoreDraft: restoreCheckoutDraft(input.draft),
    shouldReloadDeliveryRates: renewal.accepted === true,
    stayOnStep: text(input.draft.step) || "choose_delivery",
    tokenChanged: renewal.tokenChanged === true,
  };
}

export function checkoutAfterReconnectCancelled(
  draft: CheckoutDraft,
  source: CheckoutAuthSource = "home-checkout"
) {
  return {
    restoreDraft: restoreCheckoutDraft(draft),
    message:
      source === "soko-standalone"
        ? CHECKOUT_RECONNECT_CANCELLED_MESSAGE
        : CHECKOUT_REAUTH_CANCELLED_MESSAGE,
    shouldReloadDeliveryRates: false,
  };
}
