"use client";

export type PastorApproval = {
  matchId: string;
  approved: boolean;
  pastorName?: string;
  approvedAt?: number;
};

const KEY = "courtship_pastor_approvals_v1";

function readAll(): PastorApproval[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function writeAll(list: PastorApproval[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getPastorApproval(matchId: string): PastorApproval | null {
  const all = readAll();
  return all.find((a) => a.matchId === matchId) || null;
}

export function setPastorApproved(matchId: string, pastorName: string) {
  const all = readAll();
  const next: PastorApproval = {
    matchId,
    approved: true,
    pastorName,
    approvedAt: Date.now(),
  };

  const merged = all.some((a) => a.matchId === matchId)
    ? all.map((a) => (a.matchId === matchId ? next : a))
    : [...all, next];

  writeAll(merged);
}

export function resetPastorApproval(matchId: string) {
  const all = readAll().filter((a) => a.matchId !== matchId);
  writeAll(all);
}
