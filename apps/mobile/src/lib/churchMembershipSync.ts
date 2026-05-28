export type ProfileMembershipPayload = {
  churchId?: string;
  churchRole?: string;
  role?: string;
  activeMembership?: {
    churchId?: string;
    churchRole?: string;
    status?: string;
  } | null;
};

export function isActiveMembershipStatus(status?: string | null) {
  const s = String(status || "").trim();
  return s === "Active" || s === "Approved";
}

const BLOCKED_DEMO_CHURCH_IDS = new Set([
  "church_dev_default",
  "c-demo-1",
  "c-demo-2",
  "c-demo-3",
  "c1",
  "c2",
]);

export function isBlockedDemoChurchId(churchId?: string | null) {
  const id = String(churchId || "").trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (BLOCKED_DEMO_CHURCH_IDS.has(id) || BLOCKED_DEMO_CHURCH_IDS.has(lower)) return true;
  if (/^c-demo-/i.test(id)) return true;
  if (/^church_demo_/i.test(id)) return true;
  return false;
}

export function countsAsRealActiveChurchId(churchId?: string | null) {
  const id = String(churchId || "").trim();
  if (!id) return false;
  return !isBlockedDemoChurchId(id);
}

export function resolveActiveChurchFromProfileResponse(
  res: ProfileMembershipPayload | null | undefined
): { churchId: string; role: string; membership: ProfileMembershipPayload["activeMembership"] } {
  if (!res) return { churchId: "", role: "Member", membership: null };

  const membership = res.activeMembership ?? null;
  if (membership) {
    if (!isActiveMembershipStatus(membership.status)) {
      return { churchId: "", role: "Member", membership: null };
    }
    const churchId = String(membership.churchId || res.churchId || "").trim();
    if (!countsAsRealActiveChurchId(churchId)) {
      return { churchId: "", role: "Member", membership: null };
    }
    return {
      churchId,
      role: String(membership.churchRole || res.churchRole || res.role || "Member").trim() || "Member",
      membership,
    };
  }

  const topChurchId = String(res.churchId || "").trim();
  if (!topChurchId || !countsAsRealActiveChurchId(topChurchId)) {
    return { churchId: "", role: "Member", membership: null };
  }

  return {
    churchId: topChurchId,
    role: String(res.churchRole || res.role || "Member").trim() || "Member",
    membership: null,
  };
}

export function profileMembershipStatus(res: ProfileMembershipPayload | null | undefined) {
  return String(res?.activeMembership?.status || "").trim();
}

export function profileHasActiveMembership(res: ProfileMembershipPayload | null | undefined) {
  const status = profileMembershipStatus(res);
  if (status) return isActiveMembershipStatus(status);
  return Boolean(resolveActiveChurchFromProfileResponse(res).churchId);
}
