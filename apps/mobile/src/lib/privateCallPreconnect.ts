import type { Room } from "livekit-client";

/**
 * LiveKit rooms connected while a private call is still ringing (so audio starts the moment the
 * call is accepted). Shared by the call screen (which creates them) and the ongoing-call host
 * (which adopts them once the call is accepted and keeps them alive across navigation).
 */
export type PreconnectedPrivateCallRoom = {
  callId: string;
  roomName: string;
  serverUrl: string;
  token: string;
  room: Room;
  subscriptionBridgeCleanup?: () => void;
};

export const preconnectedPrivateCallRooms = new Map<string, PreconnectedPrivateCallRoom>();

export function takePreconnectedPrivateCallRoom(
  callId: string,
  roomName: string
): PreconnectedPrivateCallRoom | null {
  const existing = preconnectedPrivateCallRooms.get(callId) || null;
  if (!existing) return null;

  if (existing.roomName !== roomName) {
    preconnectedPrivateCallRooms.delete(callId);
    existing.subscriptionBridgeCleanup?.();
    void existing.room.disconnect(true);
    return null;
  }

  preconnectedPrivateCallRooms.delete(callId);
  return existing;
}

export async function disposePreconnectedPrivateCallRoom(callId: string) {
  const existing = preconnectedPrivateCallRooms.get(callId);
  if (!existing) return;

  preconnectedPrivateCallRooms.delete(callId);
  existing.subscriptionBridgeCleanup?.();

  try {
    await existing.room.disconnect(true);
  } catch {
    // Best effort cleanup.
  }
}
