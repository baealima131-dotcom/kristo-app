export const MAX_CHURCH_MEDIA_HOSTS = 3;

export type ChurchMediaAccessState = {
  actualPastorUserId: string;
  mediaHostUserIds: string[];
  isActualChurchPastor: boolean;
  isMediaHost: boolean;
  canAccessChurchMedia: boolean;
  canManageMediaHosts: boolean;
};

export type ChurchMediaAccessSession = {
  userId?: string;
  role?: string;
  churchRole?: string;
};

export function resolveChurchMediaViewerRole(args: {
  role?: string;
  churchRole?: string;
  viewerRole?: string;
}): string {
  for (const candidate of [args.viewerRole, args.churchRole, args.role]) {
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
  canAccessChurchMedia?: boolean;
  canManageMediaHosts?: boolean;
  viewerRole?: string;
  role?: string;
  churchRole?: string;
}): ChurchMediaAccessState {
  const userId = String(args.userId || "").trim();
  const viewerRole = resolveChurchMediaViewerRole(args).toLowerCase();
  const isPastorRole = viewerRole === "pastor";
  const actualPastorUserId = String(args.actualPastorUserId || "").trim();
  const mediaHostUserIds = (Array.isArray(args.mediaHostUserIds) ? args.mediaHostUserIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const isActualChurchPastor =
    isPastorRole ||
    (typeof args.isActualChurchPastor === "boolean"
      ? args.isActualChurchPastor
      : !!userId && !!actualPastorUserId && userId === actualPastorUserId);

  const isMediaHost =
    typeof args.isMediaHost === "boolean"
      ? args.isMediaHost
      : !!userId && mediaHostUserIds.includes(userId);

  const serverCanAccessChurchMedia =
    typeof args.canAccessChurchMedia === "boolean"
      ? args.canAccessChurchMedia
      : false;

  const canAccessChurchMedia =
    isActualChurchPastor || isMediaHost || serverCanAccessChurchMedia;

  const serverCanManageMediaHosts =
    typeof args.canManageMediaHosts === "boolean"
      ? args.canManageMediaHosts
      : false;

  const canManageMediaHosts =
    isActualChurchPastor || serverCanManageMediaHosts;

  return {
    actualPastorUserId,
    mediaHostUserIds,
    isActualChurchPastor,
    isMediaHost,
    canAccessChurchMedia,
    canManageMediaHosts,
  };
}

export function evaluateChurchMediaAccessFromSession(
  session: ChurchMediaAccessSession | null | undefined,
  apiRes?: Record<string, unknown> | null
): ChurchMediaAccessState {
  const userId = String(session?.userId || "").trim();
  const viewerRole = resolveChurchMediaViewerRole({
    role: session?.role,
    churchRole: session?.churchRole,
  });

  if (!isChurchMediaHostsApiSuccess(apiRes)) {
    return evaluateChurchMediaAccessClient({ userId, viewerRole });
  }

  return evaluateChurchMediaAccessClient({
    userId,
    viewerRole,
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
  const viewerRole = resolveChurchMediaViewerRole({
    role: session?.role,
    churchRole: session?.churchRole,
  });
  const merged: Parameters<typeof evaluateChurchMediaAccessClient>[0] = {
    userId,
    viewerRole,
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
  for (const candidate of [session?.role, session?.churchRole]) {
    if (String(candidate || "").trim().toLowerCase() === "pastor") return true;
  }
  return false;
}

/** Never downgrade pastor/host access while a background refresh is in flight. */
export function stabilizeChurchMediaAccess(
  prev: ChurchMediaAccessState | null | undefined,
  next: ChurchMediaAccessState,
  session?: ChurchMediaAccessSession | null
): ChurchMediaAccessState {
  const sessionAccess = evaluateChurchMediaAccessFromSession(session);
  const pastorLocked = isPastorSessionRole(session) || sessionAccess.isActualChurchPastor;

  return {
    actualPastorUserId:
      next.actualPastorUserId || prev?.actualPastorUserId || sessionAccess.actualPastorUserId,
    mediaHostUserIds: next.mediaHostUserIds.length
      ? next.mediaHostUserIds
      : prev?.mediaHostUserIds?.length
        ? prev.mediaHostUserIds
        : sessionAccess.mediaHostUserIds,
    isActualChurchPastor:
      next.isActualChurchPastor ||
      Boolean(prev?.isActualChurchPastor) ||
      sessionAccess.isActualChurchPastor ||
      pastorLocked,
    isMediaHost: next.isMediaHost || Boolean(prev?.isMediaHost) || sessionAccess.isMediaHost,
    canAccessChurchMedia:
      next.canAccessChurchMedia ||
      Boolean(prev?.canAccessChurchMedia) ||
      sessionAccess.canAccessChurchMedia ||
      pastorLocked,
    canManageMediaHosts:
      next.canManageMediaHosts ||
      Boolean(prev?.canManageMediaHosts) ||
      sessionAccess.canManageMediaHosts ||
      pastorLocked,
  };
}
