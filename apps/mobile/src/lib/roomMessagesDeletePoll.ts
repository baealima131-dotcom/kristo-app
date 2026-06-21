const forcePollRoomIds = new Set<string>();

export function markRoomMessagesForcePoll(roomId: string) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  forcePollRoomIds.add(rid);
}

export function markRoomMessagesForcePollAfterDelete(roomId: string) {
  markRoomMessagesForcePoll(roomId);
}

export function consumeRoomMessagesForcePoll(roomId: string): boolean {
  const rid = String(roomId || "").trim();
  if (!rid || !forcePollRoomIds.has(rid)) return false;
  forcePollRoomIds.delete(rid);
  return true;
}

export function consumeRoomMessagesForcePollAfterDelete(roomId: string): boolean {
  return consumeRoomMessagesForcePoll(roomId);
}

export function hasRoomMessagesForcePoll(roomId: string): boolean {
  return forcePollRoomIds.has(String(roomId || "").trim());
}

export function hasRoomMessagesForcePollAfterDelete(roomId: string): boolean {
  return hasRoomMessagesForcePoll(roomId);
}
