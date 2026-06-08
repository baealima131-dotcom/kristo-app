export const MINISTRY_MEDIA_ACCESS_LIMIT = 3;
export const MINISTRY_MEDIA_ACCESS_LIMIT_CODE = "MINISTRY_MEDIA_ACCESS_LIMIT_REACHED";
export const MINISTRY_MEDIA_ACCESS_LIMIT_ERROR = "Media access limit reached";

export type MinistryMediaAccessRow = {
  id?: string;
  churchId?: string;
  mediaAccess?: boolean;
};

export function countChurchMinistriesWithMediaAccess(
  ministries: MinistryMediaAccessRow[],
  churchId: string,
  excludeMinistryId?: string
): number {
  const cid = String(churchId || "").trim();
  const excludeId = String(excludeMinistryId || "").trim();
  if (!cid) return 0;

  return (Array.isArray(ministries) ? ministries : []).filter((row) => {
    if (String(row?.churchId || "").trim() !== cid) return false;
    if (excludeId && String(row?.id || "").trim() === excludeId) return false;
    return row?.mediaAccess === true;
  }).length;
}

export function wouldExceedMinistryMediaAccessLimit(args: {
  ministries: MinistryMediaAccessRow[];
  churchId: string;
  enablingMediaAccess: boolean;
  excludeMinistryId?: string;
}): boolean {
  if (!args.enablingMediaAccess) return false;
  return (
    countChurchMinistriesWithMediaAccess(
      args.ministries,
      args.churchId,
      args.excludeMinistryId
    ) >= MINISTRY_MEDIA_ACCESS_LIMIT
  );
}

export function logMinistryMediaAccessLimit(args: {
  churchId: string;
  userId: string;
  currentMediaAccessCount: number;
  limit?: number;
  action: string;
}) {
  console.log("KRISTO_MINISTRY_MEDIA_ACCESS_LIMIT", {
    churchId: String(args.churchId || "").trim(),
    userId: String(args.userId || "").trim(),
    currentMediaAccessCount: Number(args.currentMediaAccessCount || 0),
    limit: Number(args.limit ?? MINISTRY_MEDIA_ACCESS_LIMIT),
    action: String(args.action || "").trim(),
  });
}

export function ministryMediaAccessLimitPayload() {
  return {
    ok: false as const,
    code: MINISTRY_MEDIA_ACCESS_LIMIT_CODE,
    error: MINISTRY_MEDIA_ACCESS_LIMIT_ERROR,
  };
}
