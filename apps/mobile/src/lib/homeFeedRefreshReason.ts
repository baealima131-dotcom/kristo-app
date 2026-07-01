/** Shared Home Feed refresh predicates — no imports from feed network/cache/utils. */

export function shouldHardRefreshHomeFeed(reason: string, force?: boolean): boolean {
  if (force) return true;
  const r = String(reason || "").trim();
  return (
    r.includes("schedule-dirty") ||
    r.includes("post-delete") ||
    r.startsWith("slot-claim") ||
    r === "claim-slot-focus"
  );
}

/** Rebuild persisted personal display order (not on poll / mid-session focus). */
export function shouldRebuildHomeFeedDisplayOrder(reason: string, force?: boolean): boolean {
  if (force || shouldHardRefreshHomeFeed(reason, force)) return true;
  const r = String(reason || "").trim();
  if (r === "load" || r === "cold-start-rotate") return true;
  if (r.includes("post-create") || r.includes("new-post") || r.includes("pull-refresh")) {
    return true;
  }
  if (r === "local-post-created" || r === "first-install") return true;
  return false;
}
