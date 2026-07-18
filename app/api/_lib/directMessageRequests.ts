import { getMembershipsForUser } from "@/app/api/_lib/memberships";
import {
  claimInitiatorOutboundSlotAtomic,
  releaseInitiatorOutboundSlotAtomic,
  type DirectMessageRelationshipRecord,
} from "@/app/api/_lib/store/directMessageRelationshipDb";
import type { DmRequestThreadRecord } from "@/app/api/_lib/directMessageRequestLogic";

export {
  DM_REQUEST_OUTGOING_MESSAGE_LIMIT,
  DM_REQUEST_MESSAGE_LIMIT_REACHED,
  buildDmRequestQuota,
  claimOutboundSlotInStore,
  findThreadEntryByRoomId,
  resolveDmRelationshipStatus,
  threadStoreKey,
  type DmRelationshipStatus,
  type DmRequestQuota,
  type DmRequestThreadRecord,
} from "@/app/api/_lib/directMessageRequestLogic";

function normUserId(value: string) {
  return String(value || "").trim();
}

/** Two users share at least one Active membership in the same church. */
export async function usersShareActiveChurch(
  userIdA: string,
  userIdB: string
): Promise<string | null> {
  const a = normUserId(userIdA);
  const b = normUserId(userIdB);
  if (!a || !b || a === b) return null;

  const [rowsA, rowsB] = await Promise.all([
    getMembershipsForUser(a),
    getMembershipsForUser(b),
  ]);

  const activeA = new Set(
    rowsA
      .filter((row) => String(row.status || "") === "Active")
      .map((row) => String(row.churchId || "").trim())
      .filter(Boolean)
  );

  for (const row of rowsB) {
    if (String(row.status || "") !== "Active") continue;
    const churchId = String(row.churchId || "").trim();
    if (churchId && activeA.has(churchId)) return churchId;
  }
  return null;
}

export function relationshipToThreadOverlay(
  rel: DirectMessageRelationshipRecord
): Pick<
  DmRequestThreadRecord,
  | "roomId"
  | "churchId"
  | "requestStatus"
  | "requestInitiatorUserId"
  | "sameChurchAtCreation"
  | "requestOutboundCountByUserId"
  | "acceptedAt"
  | "declinedAt"
> {
  const initiator = normUserId(rel.requestInitiatorUserId);
  const count = Math.max(0, Number(rel.initiatorOutboundCount || 0) || 0);
  return {
    roomId: rel.roomId,
    churchId: rel.storageChurchId,
    requestStatus:
      rel.requestStatus === "none"
        ? undefined
        : (rel.requestStatus as "pending" | "accepted" | "declined"),
    requestInitiatorUserId: initiator || undefined,
    sameChurchAtCreation: rel.sameChurchAtCreation === true,
    requestOutboundCountByUserId: initiator
      ? { [initiator]: count }
      : {},
    acceptedAt: rel.acceptedAt ?? undefined,
    declinedAt: rel.declinedAt ?? undefined,
  };
}

export async function claimDirectMessageRequestOutboundSlot(args: {
  roomId: string;
  senderUserId: string;
  limit?: number;
}) {
  return claimInitiatorOutboundSlotAtomic(args);
}

export async function releaseDirectMessageRequestOutboundSlot(args: {
  roomId: string;
  senderUserId: string;
}) {
  await releaseInitiatorOutboundSlotAtomic(args);
}
