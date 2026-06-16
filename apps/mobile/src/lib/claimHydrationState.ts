export type ClaimOverlayKeyParts = {
  targetChurchId?: string;
  scheduleFeedId: string;
  slotId: string;
  userId: string;
};

export function buildClaimOverlayKey(parts: ClaimOverlayKeyParts): string {
  const targetChurchId = String(parts.targetChurchId || "").trim();
  const scheduleFeedId = String(parts.scheduleFeedId || "").trim();
  const slotId = String(parts.slotId || "").trim();
  const userId = String(parts.userId || "").trim();
  return `${targetChurchId}|${scheduleFeedId}|${slotId}|${userId}`;
}

const pendingOverlayKeys = new Set<string>();
let startupHydrationPending = true;
let startupHydrationStartedAt = Date.now();

export function beginClaimHydrationStartup() {
  startupHydrationPending = true;
  startupHydrationStartedAt = Date.now();
}

export function finishClaimHydrationStartup(reason?: string) {
  if (!startupHydrationPending) return;
  startupHydrationPending = false;
  pendingOverlayKeys.clear();
  console.log("KRISTO_CLAIM_HYDRATION_COMPLETE", {
    reason: reason || "startup",
    durationMs: Date.now() - startupHydrationStartedAt,
  });
}

export function markClaimHydrationPending(parts: ClaimOverlayKeyParts) {
  const key = buildClaimOverlayKey(parts);
  if (!key.replace(/\|/g, "").trim()) return;
  pendingOverlayKeys.add(key);
  startupHydrationPending = true;
}

export function resolveClaimHydration(parts: ClaimOverlayKeyParts) {
  pendingOverlayKeys.delete(buildClaimOverlayKey(parts));
  if (!pendingOverlayKeys.size) {
    startupHydrationPending = false;
  }
}

export function isClaimHydrationPending(parts?: Partial<ClaimOverlayKeyParts>): boolean {
  if (!parts) return startupHydrationPending || pendingOverlayKeys.size > 0;
  const key = buildClaimOverlayKey({
    targetChurchId: parts.targetChurchId,
    scheduleFeedId: String(parts.scheduleFeedId || ""),
    slotId: String(parts.slotId || ""),
    userId: String(parts.userId || ""),
  });
  return startupHydrationPending || pendingOverlayKeys.has(key);
}

export type ClaimButtonStateSourceLog = {
  source: "cache" | "backend" | "claim-store" | "ring-hint" | "merged" | "preserved";
  claimHydrationPending: boolean;
  claimedByMe: boolean;
  preservedByLocalClaim: boolean;
  backendClaimedByUserId: string;
  feedId?: string;
  slotId?: string;
  targetChurchId?: string;
};

export function logClaimButtonStateSource(payload: ClaimButtonStateSourceLog) {
  console.log("KRISTO_CLAIM_BUTTON_STATE_SOURCE", payload);
}
