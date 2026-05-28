export const MAX_CHURCH_MEDIA_HOSTS = 3;

export type ChurchMediaAccessState = {
  actualPastorUserId: string;
  mediaHostUserIds: string[];
  isActualChurchPastor: boolean;
  isMediaHost: boolean;
  canAccessChurchMedia: boolean;
  canManageMediaHosts: boolean;
};

export function evaluateChurchMediaAccessClient(args: {
  userId?: string;
  actualPastorUserId?: string;
  mediaHostUserIds?: string[];
  isActualChurchPastor?: boolean;
  isMediaHost?: boolean;
  canAccessChurchMedia?: boolean;
  canManageMediaHosts?: boolean;
}): ChurchMediaAccessState {
  const userId = String(args.userId || "").trim();
  const actualPastorUserId = String(args.actualPastorUserId || "").trim();
  const mediaHostUserIds = (Array.isArray(args.mediaHostUserIds) ? args.mediaHostUserIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const isActualChurchPastor =
    typeof args.isActualChurchPastor === "boolean"
      ? args.isActualChurchPastor
      : !!userId && !!actualPastorUserId && userId === actualPastorUserId;

  const isMediaHost =
    typeof args.isMediaHost === "boolean"
      ? args.isMediaHost
      : !!userId && mediaHostUserIds.includes(userId);

  const canAccessChurchMedia =
    typeof args.canAccessChurchMedia === "boolean"
      ? args.canAccessChurchMedia
      : isActualChurchPastor || isMediaHost;

  const canManageMediaHosts =
    typeof args.canManageMediaHosts === "boolean"
      ? args.canManageMediaHosts
      : isActualChurchPastor;

  return {
    actualPastorUserId,
    mediaHostUserIds,
    isActualChurchPastor,
    isMediaHost,
    canAccessChurchMedia,
    canManageMediaHosts,
  };
}

export function parseMediaHostUserIdsFromHosts(hosts: unknown): string[] {
  return (Array.isArray(hosts) ? hosts : [])
    .map((host: any) => String(host?.userId || host?.id || "").trim())
    .filter(Boolean);
}
