export const MINISTRY_MEDIA_ACCESS_LIMIT = 3;
export const MINISTRY_MEDIA_ACCESS_LIMIT_CODE = "MINISTRY_MEDIA_ACCESS_LIMIT_REACHED";
export const MINISTRY_MEDIA_ACCESS_LIMIT_MESSAGE =
  "Media Access limit reached: 3 ministries max for V1.";

export function countMinistriesWithMediaAccess(rows: any[]): number {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.mediaAccess === true).length;
}

export function isMinistryMediaAccessLimitReachedError(resOrError: any): boolean {
  if (!resOrError) return false;
  const code = String(resOrError?.code || "").trim();
  const error = String(resOrError?.error || resOrError?.message || "").trim();
  return (
    code === MINISTRY_MEDIA_ACCESS_LIMIT_CODE ||
    error.toLowerCase() === "media access limit reached"
  );
}
