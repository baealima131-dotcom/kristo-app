/**
 * Pure More-tab press policy (no React Native imports — safe for node verify scripts).
 */

export type MoreTabPressDecision = "enter-more" | "stay-more-root" | "return-more-root";

/** Top-level tab route key under (tabs) — e.g. segments[1] === "more". */
export function isMoreTopLevelTabActive(segments: readonly string[] | null | undefined): boolean {
  return String(segments?.[1] || "").trim() === "more";
}

/**
 * More hub root only — e.g. /(tabs)/more or /(tabs)/more/index.
 * Any deeper segment (media, ministries, my-church-room, …) is nested.
 */
export function isMoreRootRoute(segments: readonly string[] | null | undefined): boolean {
  if (!isMoreTopLevelTabActive(segments)) return false;
  const deeper = (segments || [])
    .slice(2)
    .map((s) => String(s || "").trim())
    .filter((s) => s && s !== "index");
  return deeper.length === 0;
}

/** Any route under the More tab that is not the More hub root. */
export function isMoreNestedRoute(segments: readonly string[] | null | undefined): boolean {
  return isMoreTopLevelTabActive(segments) && !isMoreRootRoute(segments);
}

/**
 * Decide More tab-bar press outcome from expo-router segments.
 * - enter-more: other top-level tab → More (run transition once)
 * - stay-more-root: already on More hub (no-op)
 * - return-more-root: nested More screen → replace to More hub (no transition)
 */
export function decideMoreTabBarPress(
  segments: readonly string[] | null | undefined
): MoreTabPressDecision {
  if (!isMoreTopLevelTabActive(segments)) return "enter-more";
  if (isMoreRootRoute(segments)) return "stay-more-root";
  return "return-more-root";
}
