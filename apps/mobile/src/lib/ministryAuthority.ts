export type MinistryAuthorityTier = "pastor" | "leader" | "host" | "member";

export type MinistryAuthority = {
  tier: MinistryAuthorityTier;
  canManageMembers: boolean;
  canManageHosts: boolean;
  canPromoteLeader: boolean;
  canCreateMeeting: boolean;
  canEditMeetingSlots: boolean;
  canDeleteMeetingSlots: boolean;
  canSeeAllEdits: boolean;
  canOpenTlmcTools: boolean;
  canMuteOrRemovePeople: boolean;
};

export function normalizeMinistryRole(raw: unknown): MinistryAuthorityTier {
  const role = String(raw || "").trim().toLowerCase();
  if (role.includes("pastor")) return "pastor";
  if (role.includes("leader") || role.includes("admin") || role.includes("assistant")) return "leader";
  if (role.includes("host") || role.includes("tlmc")) return "host";
  return "member";
}

export function isPastorAppRole(raw: unknown) {
  const role = String(raw || "").trim().toLowerCase();
  return (
    role.includes("pastor") ||
    role.includes("church_admin") ||
    role.includes("system_admin")
  );
}

export function resolveMinistryAuthority(input: {
  appRole?: string;
  ministryRole?: string;
  isChurchPastor?: boolean;
  isSelectedMcHost?: boolean;
}): MinistryAuthority {
  const ministryTier = normalizeMinistryRole(input.ministryRole);
  const appPastor = isPastorAppRole(input.appRole) || !!input.isChurchPastor;

  let tier: MinistryAuthorityTier = "member";
  if (appPastor || ministryTier === "pastor") tier = "pastor";
  else if (ministryTier === "leader") tier = "leader";
  else if (ministryTier === "host" || input.isSelectedMcHost) tier = "host";

  const canManageMembers = tier === "pastor" || tier === "leader";
  const canManageHosts = tier === "pastor" || tier === "leader";
  const canPromoteLeader = tier === "pastor";
  const canCreateMeeting = tier === "pastor" || tier === "leader" || tier === "host";
  const canEditMeetingSlots = tier === "pastor" || tier === "leader" || tier === "host";
  const canDeleteMeetingSlots = tier === "pastor" || tier === "leader";
  const canSeeAllEdits = tier === "pastor" || tier === "leader";
  const canOpenTlmcTools = tier === "pastor" || tier === "leader";
  const canMuteOrRemovePeople = tier === "pastor" || tier === "leader";

  return {
    tier,
    canManageMembers,
    canManageHosts,
    canPromoteLeader,
    canCreateMeeting,
    canEditMeetingSlots,
    canDeleteMeetingSlots,
    canSeeAllEdits,
    canOpenTlmcTools,
    canMuteOrRemovePeople,
  };
}

export function isProtectedMinistryMember(args: {
  userId?: string;
  actualPastorUserId?: string;
  churchRole?: string;
  isProtected?: boolean;
  isChurchPastor?: boolean;
}): boolean {
  if (args.isProtected === true || args.isChurchPastor === true) return true;
  const uid = String(args.userId || "").trim();
  const pastorId = String(args.actualPastorUserId || "").trim();
  if (pastorId && uid === pastorId) return true;
  return isPastorAppRole(args.churchRole || "");
}

export function applyPastorAuthorityToMinistryBoard<T extends Record<string, any>>(
  people: T[],
  args: { actualPastorUserId?: string; ministryId?: string; fallbackName?: string }
): T[] {
  const pastorUserId = String(args.actualPastorUserId || "").trim();
  if (!pastorUserId) return people;

  const ministryId = String(args.ministryId || "").trim();
  let found = false;

  const next = people.map((row) => {
    const uid = String(row.userId || row.id || "").trim();
    if (uid !== pastorUserId) return row;
    found = true;
    return {
      ...row,
      role: "Pastor",
      ministryRole: "Leader",
      isChurchPastor: true,
      isProtected: true,
      note: "Church pastor • protected",
    };
  });

  if (!found) {
    next.unshift({
      id: `pastor_authority_${pastorUserId}`,
      ministryMemberId: "",
      userId: pastorUserId,
      ministryId,
      name: args.fallbackName || "Pastor",
      displayName: args.fallbackName || "Pastor",
      role: "Pastor",
      ministryRole: "Leader",
      status: "Active",
      note: "Church pastor • protected",
      isChurchPastor: true,
      isProtected: true,
      isSynthetic: true,
    } as unknown as T);
  }

  const pastorIdx = next.findIndex(
    (row) => String(row.userId || row.id || "").trim() === pastorUserId
  );
  if (pastorIdx > 0) {
    const [pastorRow] = next.splice(pastorIdx, 1);
    next.unshift(pastorRow);
  }

  return next;
}

export function logMinistryAuthority(
  userId: string,
  appRole: string,
  ministryRole: string,
  authority: MinistryAuthority
) {
  console.log("[MinistryAuthority]", {
    userId,
    appRole,
    ministryRole,
    tier: authority.tier,
    canManageMembers: authority.canManageMembers,
    canManageHosts: authority.canManageHosts,
    canCreateMeeting: authority.canCreateMeeting,
  });
}

export type MinistryToolKey =
  | "members_board"
  | "profile"
  | "add_remove"
  | "mc_hosts"
  | "meeting"
  | "schedule"
  | "tlmc_panel"
  | "election"
  | "targeted_msg"
  | "broadcast"
  | "visibility"
  | "permissions"
  | "pause";

const PASTOR_LEADER_TOOLS: MinistryToolKey[] = [
  "profile",
  "add_remove",
  "pause",
  "visibility",
  "permissions",
  "tlmc_panel",
  "election",
  "targeted_msg",
  "broadcast",
];

export function canOpenMinistryTool(
  toolKey: MinistryToolKey,
  authority: MinistryAuthority,
  opts?: { isSelectedMcHost?: boolean }
): boolean {
  switch (toolKey) {
    case "members_board":
      return true;
    case "profile":
    case "add_remove":
    case "pause":
    case "visibility":
    case "permissions":
    case "tlmc_panel":
    case "election":
    case "targeted_msg":
    case "broadcast":
      return authority.tier === "pastor" || authority.tier === "leader";
    case "mc_hosts":
      return authority.canManageHosts || !!opts?.isSelectedMcHost;
    case "meeting":
    case "schedule":
      return authority.canCreateMeeting;
    default:
      return false;
  }
}

export function ministryToolLockMessage(toolKey: MinistryToolKey): string {
  if (PASTOR_LEADER_TOOLS.includes(toolKey) || toolKey === "mc_hosts") {
    return "This tool requires Pastor or Leader access.";
  }
  return "This tool requires Pastor, Leader, or Host access.";
}

export function logMinistryToolGate(args: {
  toolKey: MinistryToolKey;
  allowed: boolean;
  ministryRole: string;
  appRole: string;
}) {
  console.log("[MinistryToolGate]", {
    toolKey: args.toolKey,
    allowed: args.allowed,
    ministryRole: args.ministryRole,
    appRole: args.appRole,
  });
}
