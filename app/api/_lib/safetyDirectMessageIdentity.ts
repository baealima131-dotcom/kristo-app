/*
 * Legacy direct-message reports may not persist an explicit
 * reported/target owner user id. Recover the reported peer from
 * the durable DM room identity "dm:userA::userB".
 *
 * This is the single, dependency-free source of truth used by BOTH
 * the GET case hydration and the PATCH issue_decision target
 * resolution so the two paths cannot diverge into different parsers.
 *
 * Behavior:
 *  - Only applies when report.sourceType === "direct_message".
 *  - Reads the first non-empty of report.sourceRoomId, report.sourceId.
 *  - Accepts only the canonical "dm:userA::userB" format.
 *  - Requires exactly two non-empty participants.
 *  - Requires the reporter to be one of the two participants.
 *  - Returns the participant that is NOT the reporter.
 *  - Returns "" for any malformed, ambiguous, or
 *    reporter-not-a-participant room.
 *  - Never infers identity from the acting viewer or assigned agent.
 */
function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

export function resolveLegacyDirectMessageTargetUserId(
  report: any
): string {
  const sourceType = String(report?.sourceType || "")
    .trim()
    .toLowerCase();

  if (sourceType !== "direct_message") {
    return "";
  }

  const roomId = firstNonEmpty(
    report?.sourceRoomId,
    report?.sourceId
  );

  if (!roomId.startsWith("dm:")) {
    return "";
  }

  const participants = roomId
    .slice(3)
    .split("::")
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (participants.length !== 2) {
    return "";
  }

  const reporterUserId = firstNonEmpty(report?.reporterUserId);

  if (!reporterUserId || !participants.includes(reporterUserId)) {
    return "";
  }

  return (
    participants.find((userId) => userId !== reporterUserId) || ""
  );
}
