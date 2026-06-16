export type MinistryInviteTarget = {
  id: string;
  name: string;
  status: "pending" | "accepted" | "declined";
  respondedAt?: string;
};

export type MinistryLiveInvite = {
  id: string;
  churchId: string;
  sourceMinistryId: string;
  sourceTitle: string;
  sourceRole?: string;
  title: string;
  description?: string;
  eventDate: string;
  eventTime: string;
  createdAt: string;
  status: "scheduled" | "live" | "ended";
  targets: MinistryInviteTarget[];
};

let invites: MinistryLiveInvite[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {}
  }
}

export function listMinistryLiveInvites() {
  return [...invites].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function createMinistryLiveInvites(input: {
  churchId: string;
  sourceMinistryId: string;
  sourceTitle: string;
  sourceRole?: string;
  title: string;
  description?: string;
  eventDate: string;
  eventTime: string;
  targets: { id: string; name: string }[];
}) {
  const cleanedTargets = Array.from(
    new Map(
      (input.targets || [])
        .map((x) => ({
          id: String(x?.id || "").trim(),
          name: String(x?.name || "").trim(),
        }))
        .filter((x) => x.id && x.name)
        .map((x) => [x.id, x])
    ).values()
  );

  if (!cleanedTargets.length) return null;

  const created: MinistryLiveInvite = {
    id: `live_invite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    churchId: String(input.churchId || ""),
    sourceMinistryId: String(input.sourceMinistryId || ""),
    sourceTitle: String(input.sourceTitle || "Ministry Live"),
    sourceRole: input.sourceRole ? String(input.sourceRole) : undefined,
    title: String(input.title || "Scheduled Live"),
    description: String(input.description || ""),
    eventDate: String(input.eventDate || ""),
    eventTime: String(input.eventTime || ""),
    createdAt: new Date().toISOString(),
    status: "scheduled",
    targets: cleanedTargets.map((x) => ({
      id: x.id,
      name: x.name,
      status: "pending",
    })),
  };

  invites = [created, ...invites];
  emit();
  return created;
}

export function getMinistryInviteById(inviteId: string) {
  return invites.find((x) => x.id === inviteId) || null;
}

export function getInvitesForMinistry(ministryId: string) {
  const id = String(ministryId || "").trim();
  if (!id) return [];
  return listMinistryLiveInvites().filter((inv) =>
    Array.isArray(inv.targets) && inv.targets.some((t) => String(t.id) === id)
  );
}

export function respondToMinistryLiveInvite(input: {
  inviteId: string;
  ministryId: string;
  response: "accepted" | "declined";
}) {
  const inviteId = String(input.inviteId || "");
  const ministryId = String(input.ministryId || "");
  const response = input.response;

  let changed = false;

  invites = invites.map((inv) => {
    if (inv.id !== inviteId) return inv;

    const nextTargets = inv.targets.map((t) => {
      if (String(t.id) !== ministryId) return t;
      changed = true;
      return {
        ...t,
        status: response,
        respondedAt: new Date().toISOString(),
      };
    });

    return {
      ...inv,
      targets: nextTargets,
    };
  });

  if (changed) emit();
  return changed;
}

export function markMinistryInviteLive(inviteId: string) {
  const id = String(inviteId || "");
  let changed = false;

  invites = invites.map((inv) => {
    if (inv.id !== id) return inv;
    changed = true;
    return { ...inv, status: "live" };
  });

  if (changed) emit();
  return changed;
}

export function removeMinistryLiveInvite(inviteId: string) {
  const before = invites.length;
  invites = invites.filter((x) => x.id !== inviteId);
  if (invites.length !== before) emit();
}

export function subscribeMinistryLiveInvites(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
