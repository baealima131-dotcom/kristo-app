/**
 * Pure helpers for rolling next-slot Big Screen preflight (no RN/LiveKit deps).
 */

export type ClaimedSlotLike = {
  id?: string;
  slotId?: string;
  slot?: number | string;
  slotNumber?: number | string;
  claimedByUserId?: string;
  claimedBy?: { userId?: string; name?: string };
  claimedByName?: string;
  name?: string;
  startMs?: number;
  endMs?: number;
  claimedByAvatarUri?: string;
  claimedByAvatar?: string;
  claimedByAvatarUrl?: string;
  claimedByPhotoUrl?: string;
  avatar?: string;
  avatarUri?: string;
};

function norm(value: unknown) {
  return String(value || "").trim();
}

function sanitizeIdentityPart(value: string) {
  return norm(value).replace(/[^a-zA-Z0-9_]/g, "");
}

export function liveSlotPublisherIdentity(userId: string, slotNumber: number) {
  const uid = sanitizeIdentityPart(userId) || "slot";
  const n = Math.max(1, Math.floor(Number(slotNumber) || 1));
  return `${uid}-slot-${n}`;
}

export function liveSlotPreflightKey(target: {
  liveBridgeId: string;
  slotId: string;
  ownerUserId: string;
  slotNumber: number;
  startMs: number;
}) {
  return [
    norm(target.liveBridgeId),
    norm(target.slotId),
    norm(target.ownerUserId),
    Math.max(1, Math.floor(Number(target.slotNumber) || 1)),
    Math.max(0, Math.floor(Number(target.startMs) || 0)),
  ].join("|");
}

function pickAvatarUri(slot: ClaimedSlotLike) {
  const candidates = [
    slot.claimedByAvatarUri,
    slot.claimedByPhotoUrl,
    slot.claimedByAvatar,
    slot.claimedByAvatarUrl,
    slot.avatarUri,
    slot.avatar,
  ];
  for (const raw of candidates) {
    const uri = norm(raw);
    if (
      /^https?:\/\//i.test(uri) ||
      uri.startsWith("file://") ||
      uri.startsWith("data:image/")
    ) {
      return uri;
    }
  }
  return "";
}

/** Next claimed upcoming slot after `nowMs` (rolling N+1 only). */
export function resolveNextClaimedSlotForPreflight(
  slots: ClaimedSlotLike[] | null | undefined,
  nowMs: number
): {
  id: string;
  slotNumber: number;
  ownerUserId: string;
  ownerName: string;
  avatarUri: string;
  startMs: number;
  endMs: number;
} | null {
  const now = Number(nowMs) || Date.now();
  const upcoming = (Array.isArray(slots) ? slots : [])
    .map((slot, index) => {
      const ownerUserId = norm(
        slot?.claimedByUserId || slot?.claimedBy?.userId
      );
      const ownerName = norm(
        slot?.claimedByName || slot?.claimedBy?.name || slot?.name
      );
      if (!ownerUserId && !ownerName) return null;
      const startMs = Number(slot?.startMs || 0);
      const endMs = Number(slot?.endMs || 0);
      if (!(startMs > now) || !(endMs > startMs)) return null;
      const slotNumber = Math.max(
        1,
        Math.floor(
          Number(slot?.slot ?? slot?.slotNumber ?? index + 1) || index + 1
        )
      );
      const id =
        norm(slot?.id || slot?.slotId) ||
        `slot_${slotNumber}_${ownerUserId || ownerName}`;
      return {
        id,
        slotNumber,
        ownerUserId,
        ownerName: ownerName || "Speaker",
        avatarUri: pickAvatarUri(slot),
        startMs,
        endMs,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    slotNumber: number;
    ownerUserId: string;
    ownerName: string;
    avatarUri: string;
    startMs: number;
    endMs: number;
  }>;

  upcoming.sort(
    (a, b) => a.startMs - b.startMs || a.slotNumber - b.slotNumber
  );
  return upcoming[0] || null;
}
