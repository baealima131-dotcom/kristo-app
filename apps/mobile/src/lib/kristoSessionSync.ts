import type { KristoSession } from "./kristoSessionTypes";

let _session: KristoSession | null = null;
let _scope = "";
const scopeListeners = new Set<(nextScope: string, prevScope: string) => void>();

/** Identity a local cache belongs to: user + church ("" when signed out). */
export function sessionScopeOf(s: KristoSession | null): string {
  const userId = String(s?.userId || "").trim();
  if (!userId) return "";
  const churchId = String((s as any)?.churchId || (s as any)?.activeChurchId || "").trim();
  return `${userId}::${churchId}`;
}

export function getSessionSync(): KristoSession | null {
  return _session;
}

export function getSessionScopeSync(): string {
  return _scope;
}

/** Called whenever the signed-in user or church changes (including logout). */
export function onSessionScopeChange(fn: (nextScope: string, prevScope: string) => void) {
  scopeListeners.add(fn);
  return () => {
    scopeListeners.delete(fn);
  };
}

export function setSessionSync(s: KristoSession | null) {
  _session = s;
  const nextScope = sessionScopeOf(s);
  if (nextScope === _scope) return;
  const prevScope = _scope;
  _scope = nextScope;
  for (const fn of Array.from(scopeListeners)) {
    try {
      fn(nextScope, prevScope);
    } catch {}
  }
}
