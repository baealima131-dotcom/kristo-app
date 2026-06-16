export type SessionSnapshot = {
  userId: string;
  role: "Pastor" | "Member" | "Church_Admin" | "System_Admin" | "Leader" | "Ministry_Leader";
  churchId: string;
  name?: string;
  displayName?: string;
  fullName?: string;
  avatarUri?: string;
  avatarUrl?: string;
  profileImage?: string;
} | null;

let _session: SessionSnapshot = null;

export function getSessionSnapshot(): SessionSnapshot {
  return _session;
}

export function setSessionSnapshot(s: SessionSnapshot) {
  _session = s;
}
