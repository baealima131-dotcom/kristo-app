import type { KristoSession } from "./kristoSessionTypes";

let _session: KristoSession | null = null;

export function getSessionSync(): KristoSession | null {
  return _session;
}

export function setSessionSync(s: KristoSession | null) {
  _session = s;
}
