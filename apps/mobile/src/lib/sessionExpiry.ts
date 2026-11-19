/**
 * Session expiry signal. When the server answers 401 with { reauth: true } (or
 * reason "session_expired"), the signed session can no longer be used: the
 * session provider signs the user out and the app returns to the login screen.
 */
type Listener = () => void;
let listener: Listener | null = null;
let lastFiredAt = 0;

export function onSessionExpired(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function isSessionExpiredResponse(status: number, body: any): boolean {
  if (status !== 401 || !body || typeof body !== "object") return false;
  return body.reauth === true || String(body.reason || "") === "session_expired";
}

export function notifySessionExpired(): void {
  const now = Date.now();
  if (now - lastFiredAt < 5000) return; // several requests may fail together
  lastFiredAt = now;
  try {
    listener?.();
  } catch {}
}
