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
