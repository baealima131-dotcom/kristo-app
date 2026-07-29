/**
 * After POST /api/church/ministries, the backend already seeds the creating
 * viewer as Leader. The create UI also locks autoPastorUserId in the picker.
 * Only POST additional manually selected people — never re-POST the auto pastor
 * (or the seeded creator when distinct).
 */

export function planAdditionalMinistryMemberPosts(args: {
  pickedLeaderIds: string[];
  pickedMemberIds: string[];
  /** Locked pastor from the create picker — already on ministry when creator is Pastor. */
  autoPastorUserId?: string | null;
  /** Authenticated creator; backend seeds this user as Leader on ministry create. */
  seededCreatorUserId?: string | null;
}): {
  leadersToPost: string[];
  membersToPost: string[];
  skippedUserIds: string[];
  /** Full leader set for UI counts (includes auto pastor). */
  displayLeaderIds: string[];
  displayMemberIds: string[];
} {
  const autoPastor = String(args.autoPastorUserId || "").trim();
  const seeded = String(args.seededCreatorUserId || "").trim();

  const skip = new Set<string>();
  if (autoPastor) skip.add(autoPastor);
  if (seeded) skip.add(seeded);

  const withAuto = (ids: string[]) => {
    const out = Array.from(new Set(ids.map((x) => String(x || "").trim()).filter(Boolean)));
    if (autoPastor && !out.includes(autoPastor)) out.push(autoPastor);
    return out;
  };

  const displayLeaderIds = withAuto(args.pickedLeaderIds);
  const displayMemberIds = withAuto(args.pickedMemberIds).filter((id) => !displayLeaderIds.includes(id));

  const leadersToPost = displayLeaderIds.filter((id) => !skip.has(id));
  const membersToPost = displayMemberIds.filter((id) => !skip.has(id));

  return {
    leadersToPost,
    membersToPost,
    skippedUserIds: Array.from(skip),
    displayLeaderIds,
    displayMemberIds,
  };
}

/** True when a ministry-members POST should be treated as success (create or idempotent). */
export function isMinistryMemberPostSuccess(response: {
  ok?: boolean;
  alreadyExists?: boolean;
  status?: number;
} | null | undefined): boolean {
  if (!response) return false;
  if (response.ok === true) return true;
  if (response.alreadyExists === true) return true;
  if (response.status === 200 || response.status === 201) return true;
  return false;
}
