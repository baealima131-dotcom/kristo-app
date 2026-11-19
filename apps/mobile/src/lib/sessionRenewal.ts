import { getApiBase } from "./kristoApi";
import { getSessionSync, setSessionSync } from "./kristoSessionSync";
import { loadSession, saveSession } from "./kristoSession";
import { isSessionExpiredResponse, notifySessionExpired } from "./sessionExpiry";

/** Renew once the signed token is older than this (tokens last 30 days). */
const RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
let inFlight: Promise<void> | null = null;

function tokenIssuedAt(token: string): number | null {
  try {
    const payload = String(token || "").split(".")[0];
    if (!payload) return null;
    const json = JSON.parse(
      globalThis.atob ? globalThis.atob(payload.replace(/-/g, "+").replace(/_/g, "/")) : ""
    );
    const iat = Number(json?.iat);
    return Number.isFinite(iat) ? iat : null;
  } catch {
    return null;
  }
}

/** Swap a still-valid token for a fresh one when it is getting old. Safe to call often. */
export function renewSessionTokenIfStale(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const s = getSessionSync();
    const token = String(s?.sessionToken || "").trim();
    if (!s?.userId || !token) return;
    const iat = tokenIssuedAt(token);
    if (iat !== null && Date.now() - iat < RENEW_AFTER_MS) return;
    try {
      const res = await fetch(`${getApiBase()}/api/auth/session/renew`, {
        method: "POST",
        headers: { accept: "application/json", "x-kristo-session-token": token },
      });
      const body = await res.json().catch(() => null);
      if (isSessionExpiredResponse(res.status, body)) {
        notifySessionExpired();
        return;
      }
      if (!res.ok || !body?.ok || !body?.sessionToken || String(body.userId || "") !== String(s.userId)) return;
      // Signed out (or switched account) while the request was in flight: never bring the old session back.
      const current = await loadSession();
      if (!current || String(current.userId || "") !== String(s.userId)) return;
      if (String(current.sessionToken || "").trim() !== token) return;
      await saveSession({ ...current, sessionToken: String(body.sessionToken), expiresAt: Number(body.expiresAt) || undefined } as any);
      // Request headers read the in-memory copy: update it so the new token is used at once.
      const fresh = await loadSession();
      if (fresh) setSessionSync(fresh);
    } catch {
      // Offline or server busy: try again next time; the current token still works until it expires.
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
