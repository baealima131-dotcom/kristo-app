import type { Room, RoomConnectOptions } from "livekit-client";

const roomInstanceRegistry = new WeakMap<object, string>();
let roomInstanceCounter = 0;

export function getPrivateCallRoomInstanceId(room: unknown): string {
  if (!room || typeof room !== "object") return "none";
  let id = roomInstanceRegistry.get(room as object);
  if (!id) {
    id = `pc-room-${++roomInstanceCounter}`;
    roomInstanceRegistry.set(room as object, id);
  }
  return id;
}

export function buildPrivateCallConnectOptions(): RoomConnectOptions {
  return {
    autoSubscribe: true,
    maxRetries: 2,
    websocketTimeout: 15000,
  };
}

export function readPrivateCallAutoSubscribeEffective(room: unknown) {
  const roomAny = room as {
    connOptions?: { autoSubscribe?: boolean };
    engine?: { client?: { connectOptions?: { autoSubscribe?: boolean } } };
    state?: string;
  };

  const connOptionsAutoSubscribe = roomAny?.connOptions?.autoSubscribe;
  const signalClientAutoSubscribe = roomAny?.engine?.client?.connectOptions?.autoSubscribe;
  const effectiveAutoSubscribe =
    connOptionsAutoSubscribe ?? signalClientAutoSubscribe ?? undefined;

  return {
    effectiveAutoSubscribe,
    connOptionsAutoSubscribe,
    signalClientAutoSubscribe,
    connectionState: String(roomAny?.state || ""),
    roomInstanceId: getPrivateCallRoomInstanceId(room),
  };
}

export function logPrivateCallAutoSubscribeEffective(
  room: Room | null | undefined,
  extra?: Record<string, unknown>
) {
  const snapshot = room ? readPrivateCallAutoSubscribeEffective(room) : {
    effectiveAutoSubscribe: undefined,
    connOptionsAutoSubscribe: undefined,
    signalClientAutoSubscribe: undefined,
    connectionState: "",
    roomInstanceId: "none",
  };

  console.log("KRISTO_PRIVATE_CALL_AUTOSUBSCRIBE_EFFECTIVE", {
    ...snapshot,
    ...(extra || {}),
    ts: Date.now(),
  });

  return snapshot.effectiveAutoSubscribe;
}
