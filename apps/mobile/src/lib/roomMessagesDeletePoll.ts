const forcePollRoomIds = new Set<string>();

export function markRoomMessagesForcePollAfterDelete(roomId: string) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  forcePollRoomIds.add(rid);
}

export function consumeRoomMessagesForcePollAfterDelete(roomId: string): boolean {
  const rid = String(roomId || "").trim();
  if (!rid || !forcePollRoomIds.has(rid)) return false;
  forcePollRoomIds.delete(rid);
  return true;
}

export function hasRoomMessagesForcePollAfterDelete(roomId: string): boolean {
  return forcePollRoomIds.has(String(roomId || "").trim());
}
