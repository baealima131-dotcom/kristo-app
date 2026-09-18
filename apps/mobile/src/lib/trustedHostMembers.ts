export type TrustedHostMember = {
  id?: string;
  membershipId?: string;
  churchId?: string;
  status?: string;
  userId: string;
  role?: string;
  roleLabel?: string;
  name?: string;
  displayName?: string;
  avatarUrl?: string;
  avatarUri?: string;
  kristoId?: string;
  userCode?: string;
};

type SavedHost = { userId: string; name: string };

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isActiveMemberOfChurch(member: TrustedHostMember, churchId: string): boolean {
  const userId = normalized(member?.userId);
  const status = normalized(member?.status);
  const memberChurchId = normalized(member?.churchId);
  const currentChurchId = normalized(churchId);

  if (!userId || !currentChurchId) return false;

  // /api/church/members is already scoped by the authenticated church and only
  // returns active memberships. Older deployed versions omit these two fields,
  // so only reject them when an explicit value contradicts the current church.
  if (status && status !== "active") return false;
  if (memberChurchId && memberChurchId !== currentChurchId) return false;
  return true;
}

function activeMemberIds(response: any, churchId: string): Set<string> {
  if (response?.ok !== true || !Array.isArray(response.data)) {
    throw new Error(String(response?.error || "Could not load church members. Please try again."));
  }
  return new Set(response.data
    .filter((member: TrustedHostMember) => isActiveMemberOfChurch(member, churchId))
    .map((member: TrustedHostMember) => normalized(member.userId))
    .filter(Boolean));
}

export function reconcileTrustedHostSlots<T extends SavedHost>(
  hosts: Array<T | null>,
  response: any,
  churchId: string,
): { hosts: Array<T | null>; staleHosts: T[] } {
  const activeIds = activeMemberIds(response, churchId);
  const staleHosts: T[] = [];
  const reconciled = hosts.map((host) => {
    if (!host) return null;
    if (activeIds.has(String(host.userId || "").trim().toLowerCase())) return host;
    staleHosts.push(host);
    return null;
  });
  return { hosts: reconciled, staleHosts };
}

export function eligibleTrustedHostMembers(
  response: any,
  churchId: string,
  assignedUserIds: string[],
): TrustedHostMember[] {
  if (response?.ok !== true || !Array.isArray(response.data)) {
    throw new Error(String(response?.error || "Could not load church members. Please try again."));
  }
  const assigned = new Set(assignedUserIds.map((id) => id.trim().toLowerCase()));
  return response.data.filter((member: TrustedHostMember) => {
    const userId = normalized(member?.userId);
    const role = normalized(member?.role || member?.roleLabel);
    return Boolean(
      isActiveMemberOfChurch(member, churchId) &&
      role !== "pastor" &&
      !assigned.has(userId)
    );
  });
}

export function serializeTrustedHosts<T extends { userId: string; name: string; role: string; avatarUri?: string; avatarUrl?: string; kristoId?: string }>(
  hosts: Array<T | null>,
) {
  return hosts.filter((host): host is T => Boolean(host?.userId))
    .slice(0, 3)
    .map((host) => ({
      userId: host.userId.trim(),
      name: String(host.name || "Church member").trim(),
      role: String(host.role || "Member").trim(),
      avatarUri: String(host.avatarUri || host.avatarUrl || "").trim(),
      avatarUrl: String(host.avatarUrl || host.avatarUri || "").trim(),
      kristoId: String(host.kristoId || "").trim(),
    }));
}
