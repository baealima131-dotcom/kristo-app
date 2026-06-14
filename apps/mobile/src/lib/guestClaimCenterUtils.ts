export const MIN_GUEST_SLOT_DURATION_MIN = 5;

export type GuestSlotUiState = "open" | "claimed" | "approved" | "locked";

export function normalizeGuestClaimSlot(rawSlot: any) {
  const rawClaimedBy =
    typeof rawSlot?.claimedBy === "string" ? String(rawSlot.claimedBy).trim() : "";

  const normalizedClaimedBy = rawClaimedBy.toLowerCase() === "open" ? "" : rawClaimedBy;

  const rawClaimedByObj =
    typeof rawSlot?.claimedBy === "object" && rawSlot?.claimedBy ? rawSlot.claimedBy : null;

  const claimantName = String(
    rawSlot?.claimedByName || rawClaimedByObj?.name || normalizedClaimedBy || ""
  ).trim();

  const rawClaimantAvatar = String(
    rawSlot?.claimedByAvatar ||
      rawClaimedByObj?.avatarUri ||
      rawSlot?.avatarUri ||
      ""
  ).trim();

  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
  const claimantAvatar = rawClaimantAvatar.startsWith("/uploads/")
    ? `${apiBase}${rawClaimantAvatar}`
    : rawClaimantAvatar;

  const slotStatus = String(rawSlot?.status || "").toLowerCase().trim();
  const claimedUserId = String(
    rawSlot?.claimedByUserId || rawClaimedByObj?.userId || ""
  ).trim();

  const hasClaimant =
    slotStatus === "claimed" ||
    slotStatus === "taken" ||
    !!(claimantName && claimantName.toLowerCase() !== "open") ||
    !!claimedUserId;

  return {
    ...rawSlot,
    claimedBy: claimantName || (hasClaimant ? "Claimed" : "Open"),
    claimedByName: claimantName,
    claimedByUserId: claimedUserId,
    avatarUri: claimantAvatar,
    status: hasClaimant ? "claimed" : rawSlot?.status,
  };
}

export function getGuestSlotUiState(slot: any): GuestSlotUiState {
  const status = String(slot?.status || "").toLowerCase().trim();

  const rawClaimedBy = typeof slot?.claimedBy === "string" ? String(slot.claimedBy).trim() : "";

  const claimedByObj =
    typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy : null;

  const claimedName = String(
    slot?.claimedByName ||
      claimedByObj?.name ||
      (rawClaimedBy.toLowerCase() === "open" ? "" : rawClaimedBy) ||
      ""
  ).trim();

  const claimedUserId = String(slot?.claimedByUserId || claimedByObj?.userId || "").trim();

  const hasClaimant =
    status === "claimed" ||
    status === "taken" ||
    !!claimedName ||
    !!claimedUserId;

  if (slot?.approved) return "approved";
  if (slot?.locked && !hasClaimant) return "locked";
  if (hasClaimant) return "claimed";
  return "open";
}

export function getGuestSlotBadgeLabel(slot: any) {
  const state = getGuestSlotUiState(slot);
  if (state === "approved") return "Approved";
  if (state === "locked") return "Locked";
  if (state === "claimed") return "Claimed";
  return "Open";
}

export function slotHasClaimant(slot: any) {
  const state = getGuestSlotUiState(slot);
  return state === "claimed" || state === "approved";
}

export function isValidKristoAssignId(value: string) {
  return /^KR7-[A-Z0-9]{6,10}$/i.test(String(value || "").trim());
}
