/**
 * App-wide signal that a direct-message push arrived while the app is open. Screens that show
 * DM state (the Messages inbox) refresh from it instead of waiting for their next poll.
 */
type Listener = (roomId: string) => void;

const listeners = new Set<Listener>();

export function onDirectMessagePush(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitDirectMessagePush(roomId: string) {
  listeners.forEach((listener) => {
    try {
      listener(roomId);
    } catch {}
  });
}
