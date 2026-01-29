// app/(app)/dashboard/courtship/church/storage.ts
import type { JoinRequest, MembershipStatus } from "./types";

const KEY = "kristo.joinRequests.v1";

function safeParse(raw: string | null): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadJoinRequests(): JoinRequest[] {
  if (typeof window === "undefined") return [];
  const data = safeParse(localStorage.getItem(KEY));
  return Array.isArray(data) ? (data as JoinRequest[]) : [];
}

export function saveJoinRequests(reqs: JoinRequest[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(reqs));
}

export function getMyJoinRequest(userId: string, churchId: string): JoinRequest | null {
  const all = loadJoinRequests();
  return all.find((r) => r.userId === userId && r.churchId === churchId) ?? null;
}

export function upsertJoinRequest(req: JoinRequest) {
  const all = loadJoinRequests();
  const idx = all.findIndex((r) => r.id === req.id);
  const next = [...all];

  if (idx >= 0) next[idx] = req;
  else next.unshift(req);

  saveJoinRequests(next);
  return req;
}

export function setJoinRequestStatus(requestId: string, status: MembershipStatus) {
  const all = loadJoinRequests();
  const idx = all.findIndex((r) => r.id === requestId);
  if (idx < 0) return null;

  const updated: JoinRequest = {
    ...all[idx],
    status,
    updatedAt: Date.now(),
  };

  const next = [...all];
  next[idx] = updated;
  saveJoinRequests(next);
  return updated;
}
