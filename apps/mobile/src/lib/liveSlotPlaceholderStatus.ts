export type LiveSlotPlaceholderStatus =
  | "live"
  | "not_joined"
  | "camera_off"
  | "left"
  | "open_slot";

export function sanitizeLiveSlotDisplayName(name: string, fallback = "Speaker"): string {
  const raw = String(name || "").trim();
  if (!raw) return fallback;
  if (/^(ch|min)_[a-z0-9_-]+$/i.test(raw)) return fallback;
  if (/^CH\d[\w-]*$/i.test(raw)) return fallback;
  if (/^min_[a-z0-9_-]+$/i.test(raw)) return fallback;
  return raw;
}

export function liveSlotPlaceholderFirstName(name: string): string {
  const clean = sanitizeLiveSlotDisplayName(name, "");
  if (!clean) return "";
  return clean.split(/\s+/)[0] || clean;
}

export function resolveLiveSlotPlaceholderStatus(input: {
  slotIsOpen: boolean;
  claimedByUserId?: string;
  participantJoined: boolean;
  cameraEnabled: boolean;
  participantDisconnected: boolean;
}): LiveSlotPlaceholderStatus {
  if (input.slotIsOpen || !String(input.claimedByUserId || "").trim()) {
    return "open_slot";
  }
  if (input.participantDisconnected) return "left";
  if (!input.participantJoined) return "not_joined";
  if (!input.cameraEnabled) return "camera_off";
  return "live";
}

export function liveSlotPlaceholderStatusLabel(
  status: LiveSlotPlaceholderStatus,
  claimedUserName?: string
): string {
  const firstName = liveSlotPlaceholderFirstName(String(claimedUserName || ""));
  switch (status) {
    case "open_slot":
      return "Open slot";
    case "not_joined":
      return firstName ? `Waiting for ${firstName}` : "Not joined yet";
    case "camera_off":
      return "Camera paused";
    case "left":
      return "Left live";
    case "live":
      return "Live";
    default:
      return "Available now";
  }
}
