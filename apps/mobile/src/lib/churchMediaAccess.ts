export const MAX_CHURCH_MEDIA_HOSTS = 3;

export type ChurchMediaAccessState = {
  actualPastorUserId: string;
  mediaHostUserIds: string[];
  isActualChurchPastor: boolean;
  isMediaHost: boolean;
  subscriptionActive?: boolean;
  /** Role-based screen entry — not blocked by inactive subscription. */
  canOpenMediaScreen: boolean;
  /** Subscription-gated media/live tools (slots, guests, hosts, publish). */
  canUseMediaTools: boolean;
  /** @deprecated Alias for canOpenMediaScreen (More tab / legacy callers). */
  canAccessChurchMedia: boolean;
  canManageMediaHosts: boolean;
};

export type ChurchMediaAccessSession = {
  userId?: string;
  role?: string;
  churchRole?: string;
  membershipRole?: string;
  profileRole?: string;
};

export function normalizePastorRoleToken(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function isPastorRoleToken(value?: string | null): boolean {
  const normalized = normalizePastorRoleToken(value);
  return normalized === "pastor" || normalized.includes("pastor");
}

export type PastorRoleSources = {
  userId?: string;
  sessionRole?: string;
  churchRole?: string;
  membershipRole?: string;
  profileRole?: string;
  actualPastorUserId?: string;
  serverIsActualChurchPastor?: boolean;
};

/** Single source of truth: any authoritative Pastor signal grants pastor access. */
export function resolveIsActualChurchPastor(sources: PastorRoleSources): boolean {
  const userId = String(sources.userId || "").trim();
  const actualPastorUserId = String(sources.actualPastorUserId || "").trim();

  const fromRoles =
    isPastorRoleToken(sources.sessionRole) ||
    isPastorRoleToken(sources.churchRole) ||
    isPastorRoleToken(sources.membershipRole) ||
    isPastorRoleToken(sources.profileRole);

  const fromMembershipId = !!userId && !!actualPastorUserId && userId === actualPastorUserId;

  if (fromRoles || fromMembershipId) return true;
  return sources.serverIsActualChurchPastor === true;
}

export function pastorRoleSourcesFromSession(
  session?: ChurchMediaAccessSession | null
): PastorRoleSources {
  return {
    userId: session?.userId,
    sessionRole: session?.role,
    churchRole: session?.churchRole,
    membershipRole: session?.membershipRole ?? session?.churchRole,
    profileRole: session?.profileRole ?? session?.role,
  };
}

const loggedPastorRoleAudit = new Set<string>();

export function logPastorRoleAudit(args: {
  sessionRole?: string | null;
  membershipRole?: string | null;
  profileRole?: string | null;
  churchRole?: string | null;
  isActualChurchPastor?: boolean;
  canOpenMediaScreen?: boolean;
  canUseMediaTools?: boolean;
  actualPastorUserId?: string | null;
  userId?: string | null;
  source?: string | null;
}) {
  const key = [
    args.source || "",
    args.userId || "",
    args.sessionRole || "",
    args.membershipRole || "",
    args.profileRole || "",
    args.churchRole || "",
    String(args.isActualChurchPastor),
    String(args.canOpenMediaScreen),
    String(args.canUseMediaTools),
  ].join(":");
  if (loggedPastorRoleAudit.has(key)) return;
  loggedPastorRoleAudit.add(key);
  console.log("KRISTO_PASTOR_ROLE_AUDIT", {
    sessionRole: args.sessionRole ?? null,
    membershipRole: args.membershipRole ?? null,
    profileRole: args.profileRole ?? null,
    churchRole: args.churchRole ?? null,
    isActualChurchPastor: args.isActualChurchPastor === true,
    canOpenMediaScreen: args.canOpenMediaScreen === true,
    canUseMediaTools: args.canUseMediaTools === true,
    actualPastorUserId: args.actualPastorUserId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? null,
  });
}

export function resolveChurchMediaViewerRole(args: {
  role?: string;
  churchRole?: string;
  viewerRole?: string;
}): string {
  for (const candidate of [args.viewerRole, args.role, args.churchRole]) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

export function isChurchMediaHostsApiSuccess(res: unknown): boolean {
  return Boolean(res && typeof res === "object" && (res as { ok?: boolean }).ok === true);
}

export function evaluateChurchMediaAccessClient(args: {
  userId?: string;
  actualPastorUserId?: string;
  mediaHostUserIds?: string[];
  isActualChurchPastor?: boolean;
  isMediaHost?: boolean;
  subscriptionActive?: boolean;
  canOpenMediaScreen?: boolean;
  canUseMediaTools?: boolean;
  canAccessChurchMedia?: boolean;
  canManageMediaHosts?: boolean;
  viewerRole?: string;
  role?: string;
  churchRole?: string;
  membershipRole?: string;
  profileRole?: string;
}): ChurchMediaAccessState {
  const userId = String(args.userId || "").trim();
  const actualPastorUserId = String(args.actualPastorUserId || "").trim();
  const mediaHostUserIds = (Array.isArray(args.mediaHostUserIds) ? args.mediaHostUserIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const isActualChurchPastor = resolveIsActualChurchPastor({
    userId,
    sessionRole: args.role,
    churchRole: args.churchRole,
    membershipRole: args.membershipRole,
    profileRole: args.profileRole,
    actualPastorUserId,
    serverIsActualChurchPastor:
      typeof args.isActualChurchPastor === "boolean" ? args.isActualChurchPastor : undefined,
  });

  const isMediaHost =
    typeof args.isMediaHost === "boolean"
      ? args.isMediaHost
      : !!userId && mediaHostUserIds.includes(userId);

  const subscriptionActive =
    typeof args.subscriptionActive === "boolean" ? args.subscriptionActive : undefined;

  const serverCanManageMediaHosts =
    typeof args.canManageMediaHosts === "boolean"
      ? args.canManageMediaHosts
      : false;

  const canOpenMediaScreen = isActualChurchPastor || isMediaHost;
  const canUseMediaTools =
    subscriptionActive === true && (isActualChurchPastor || isMediaHost);
  const canAccessChurchMedia = canOpenMediaScreen;
  const canManageMediaHosts = isActualChurchPastor || serverCanManageMediaHosts;

  return {
    actualPastorUserId,
    mediaHostUserIds,
    isActualChurchPastor,
    isMediaHost,
    subscriptionActive,
    canOpenMediaScreen,
    canUseMediaTools,
    canAccessChurchMedia,
    canManageMediaHosts,
  };
}

export function evaluateChurchMediaAccessFromSession(
  session: ChurchMediaAccessSession | null | undefined,
  apiRes?: Record<string, unknown> | null
): ChurchMediaAccessState {
  const userId = String(session?.userId || "").trim();
  const roleSources = pastorRoleSourcesFromSession(session);

  if (!isChurchMediaHostsApiSuccess(apiRes)) {
    return evaluateChurchMediaAccessClient({
      userId,
      ...roleSources,
    });
  }

  return evaluateChurchMediaAccessClient({
    userId,
    ...roleSources,
    actualPastorUserId: String(apiRes?.actualPastorUserId || ""),
    mediaHostUserIds: Array.isArray(apiRes?.mediaHostUserIds)
      ? (apiRes.mediaHostUserIds as string[])
      : undefined,
    isActualChurchPastor:
      typeof apiRes?.isActualChurchPastor === "boolean"
        ? apiRes.isActualChurchPastor
        : undefined,
    isMediaHost:
      typeof apiRes?.isMediaHost === "boolean"
        ? apiRes.isMediaHost
        : typeof apiRes?.viewerIsHost === "boolean"
          ? apiRes.viewerIsHost
          : undefined,
    subscriptionActive:
      typeof apiRes?.subscriptionActive === "boolean"
        ? apiRes.subscriptionActive
        : undefined,
    canOpenMediaScreen:
      typeof apiRes?.canOpenMediaScreen === "boolean"
        ? apiRes.canOpenMediaScreen
        : typeof apiRes?.canAccessChurchMedia === "boolean"
          ? apiRes.canAccessChurchMedia
          : undefined,
    canUseMediaTools:
      typeof apiRes?.canUseMediaTools === "boolean" ? apiRes.canUseMediaTools : undefined,
    canAccessChurchMedia:
      typeof apiRes?.canAccessChurchMedia === "boolean"
        ? apiRes.canAccessChurchMedia
        : undefined,
    canManageMediaHosts:
      typeof apiRes?.canManageMediaHosts === "boolean"
        ? apiRes.canManageMediaHosts
        : typeof apiRes?.viewerCanManage === "boolean"
          ? apiRes.viewerCanManage
          : undefined,
  });
}

export function evaluateChurchMediaAccessMerged(
  session: ChurchMediaAccessSession | null | undefined,
  ...sources: Array<Record<string, unknown> | null | undefined>
): ChurchMediaAccessState {
  const userId = String(session?.userId || "").trim();
  const roleSources = pastorRoleSourcesFromSession(session);
  const merged: Parameters<typeof evaluateChurchMediaAccessClient>[0] = {
    userId,
    ...roleSources,
  };

  for (const source of sources) {
    if (!source || !isChurchMediaHostsApiSuccess(source)) continue;

    if (source.actualPastorUserId) {
      merged.actualPastorUserId = String(source.actualPastorUserId);
    }
    if (Array.isArray(source.mediaHostUserIds)) {
      merged.mediaHostUserIds = source.mediaHostUserIds as string[];
    }
    if (typeof source.isActualChurchPastor === "boolean") {
      merged.isActualChurchPastor = source.isActualChurchPastor;
    }
    if (typeof source.isMediaHost === "boolean") {
      merged.isMediaHost = source.isMediaHost;
    } else if (typeof source.viewerIsHost === "boolean") {
      merged.isMediaHost = source.viewerIsHost;
    }
    if (typeof source.subscriptionActive === "boolean") {
      merged.subscriptionActive = source.subscriptionActive;
    }
    if (typeof source.canOpenMediaScreen === "boolean") {
      merged.canOpenMediaScreen = source.canOpenMediaScreen;
    } else if (typeof source.canAccessChurchMedia === "boolean") {
      merged.canOpenMediaScreen = source.canAccessChurchMedia;
    }
    if (typeof source.canUseMediaTools === "boolean") {
      merged.canUseMediaTools = source.canUseMediaTools;
    }
    if (typeof source.canAccessChurchMedia === "boolean") {
      merged.canAccessChurchMedia = source.canAccessChurchMedia;
    }
    if (typeof source.canManageMediaHosts === "boolean") {
      merged.canManageMediaHosts = source.canManageMediaHosts;
    } else if (typeof source.viewerCanManage === "boolean") {
      merged.canManageMediaHosts = source.viewerCanManage;
    }
  }

  return evaluateChurchMediaAccessClient(merged);
}

export function parseMediaHostUserIdsFromHosts(hosts: unknown): string[] {
  return (Array.isArray(hosts) ? hosts : [])
    .map((host: any) => String(host?.userId || host?.id || "").trim())
    .filter(Boolean);
}

export function isPastorSessionRole(session?: ChurchMediaAccessSession | null): boolean {
  return resolveIsActualChurchPastor(pastorRoleSourcesFromSession(session));
}

/** Never downgrade pastor/host access while a background refresh is in flight — except subscription lapse. */
export function stabilizeChurchMediaAccess(
  prev: ChurchMediaAccessState | null | undefined,
  next: ChurchMediaAccessState,
  session?: ChurchMediaAccessSession | null,
  subscriptionActive?: boolean | null
): ChurchMediaAccessState {
  const sessionSources = pastorRoleSourcesFromSession(session);
  const sessionAccess = evaluateChurchMediaAccessFromSession(session);
  const pastorLocked = resolveIsActualChurchPastor({
    ...sessionSources,
    actualPastorUserId: next.actualPastorUserId || prev?.actualPastorUserId || sessionAccess.actualPastorUserId,
    serverIsActualChurchPastor:
      next.isActualChurchPastor ||
      Boolean(prev?.isActualChurchPastor) ||
      sessionAccess.isActualChurchPastor,
  });
  const subscriptionKnown =
    subscriptionActive === true ||
    subscriptionActive === false ||
    next.subscriptionActive === true ||
    next.subscriptionActive === false;
  const effectiveSubscriptionActive =
    subscriptionActive === true || subscriptionActive === false
      ? subscriptionActive
      : next.subscriptionActive;

  const canOpenMediaScreen =
    next.canOpenMediaScreen ||
    Boolean(prev?.canOpenMediaScreen) ||
    sessionAccess.canOpenMediaScreen ||
    pastorLocked ||
    next.isMediaHost ||
    Boolean(prev?.isMediaHost);

  const canUseMediaTools =
    effectiveSubscriptionActive === true
      ? next.canUseMediaTools ||
        Boolean(prev?.canUseMediaTools) ||
        (canOpenMediaScreen && effectiveSubscriptionActive === true)
      : false;

  const stabilized: ChurchMediaAccessState = {
    actualPastorUserId:
      next.actualPastorUserId || prev?.actualPastorUserId || sessionAccess.actualPastorUserId,
    mediaHostUserIds: next.mediaHostUserIds.length
      ? next.mediaHostUserIds
      : prev?.mediaHostUserIds?.length
        ? prev.mediaHostUserIds
        : sessionAccess.mediaHostUserIds,
    isActualChurchPastor:
      resolveIsActualChurchPastor({
        ...sessionSources,
        actualPastorUserId:
          next.actualPastorUserId || prev?.actualPastorUserId || sessionAccess.actualPastorUserId,
        serverIsActualChurchPastor:
          next.isActualChurchPastor ||
          Boolean(prev?.isActualChurchPastor) ||
          sessionAccess.isActualChurchPastor ||
          pastorLocked,
      }),
    isMediaHost: next.isMediaHost || Boolean(prev?.isMediaHost) || sessionAccess.isMediaHost,
    subscriptionActive: subscriptionKnown ? effectiveSubscriptionActive : next.subscriptionActive,
    canOpenMediaScreen,
    canUseMediaTools,
    canAccessChurchMedia: canOpenMediaScreen,
    canManageMediaHosts:
      next.canManageMediaHosts ||
      Boolean(prev?.canManageMediaHosts) ||
      sessionAccess.canManageMediaHosts ||
      pastorLocked,
  };

  return stabilized;
}

export function shouldShowMoreMediaCard(args: {
  hasChurch: boolean;
  isPastor?: boolean;
  access?: Pick<
    ChurchMediaAccessState,
    "canOpenMediaScreen" | "canAccessChurchMedia" | "isMediaHost"
  > | null;
}): boolean {
  if (!args.hasChurch) return false;
  if (args.isPastor) return true;
  const access = args.access;
  return Boolean(
    access?.canOpenMediaScreen ||
      access?.canAccessChurchMedia ||
      access?.isMediaHost
  );
}

const loggedMoreMediaCardGate = new Set<string>();

export function logMoreMediaCardGate(args: {
  userId: string;
  churchId: string;
  isPastor: boolean;
  viewerIsHost: boolean;
  canAccessChurchMedia: boolean;
  canOpenMediaScreen: boolean;
  canUseMediaTools: boolean;
  showMediaCard: boolean;
}) {
  const key = [
    args.userId,
    args.churchId,
    String(args.isPastor),
    String(args.viewerIsHost),
    String(args.canAccessChurchMedia),
    String(args.canOpenMediaScreen),
    String(args.showMediaCard),
  ].join(":");
  if (loggedMoreMediaCardGate.has(key)) return;
  loggedMoreMediaCardGate.add(key);
  console.log("KRISTO_MORE_MEDIA_CARD_GATE", args);
}

const loggedMediaCenterGate = new Set<string>();

export function logMediaCenterGate(args: {
  userId: string;
  churchId: string;
  hasMedia: boolean;
  mediaId?: string | null;
  isActualChurchPastor: boolean;
  viewerIsHost: boolean;
  canAccessChurchMedia: boolean;
  canOpenMediaScreen: boolean;
  canUseMediaTools: boolean;
  viewerCanManage: boolean;
  showNotSetup: boolean;
  mode: "pastor" | "host" | "blocked";
}) {
  const key = [
    args.userId,
    args.churchId,
    String(args.hasMedia),
    String(args.showNotSetup),
    args.mode,
  ].join(":");
  if (loggedMediaCenterGate.has(key)) return;
  loggedMediaCenterGate.add(key);
  console.log("KRISTO_MEDIA_CENTER_GATE", args);
}

const loggedMediaScreenAccessDiag = new Set<string>();

export function logMediaScreenAccessDiag(args: {
  role?: string;
  churchRole?: string;
  isActualChurchPastor?: boolean;
  churchId?: string;
  churchSubscriptionActive?: boolean | null;
  canOpenMediaScreen?: boolean;
  canUseMediaTools?: boolean;
  reason?: string;
}) {
  const key = [
    args.churchId || "",
    args.role || "",
    args.churchRole || "",
    String(args.churchSubscriptionActive),
    String(args.canOpenMediaScreen),
    String(args.canUseMediaTools),
    args.reason || "",
  ].join(":");
  if (loggedMediaScreenAccessDiag.has(key)) return;
  loggedMediaScreenAccessDiag.add(key);
  console.log("KRISTO_MEDIA_SCREEN_ACCESS_DIAG", {
    role: args.role || null,
    churchRole: args.churchRole || null,
    isActualChurchPastor: args.isActualChurchPastor === true,
    churchId: args.churchId || null,
    churchSubscriptionActive: args.churchSubscriptionActive ?? null,
    canOpenMediaScreen: args.canOpenMediaScreen === true,
    canUseMediaTools: args.canUseMediaTools === true,
    reason: args.reason || null,
  });
}
