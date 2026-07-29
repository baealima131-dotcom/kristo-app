/**
 * Pure More-tab press policy (no React Native imports — safe for node verify scripts).
 */

/** Top-level tab route key under (tabs) — e.g. segments[1] === "more". */
export function isMoreTopLevelTabActive(segments: readonly string[] | null | undefined): boolean {
  return String(segments?.[1] || "").trim() === "more";
}

export type MoreTabPressDecision = "ignored" | "transition";

/**
 * Decide whether a More tab-bar press should start an inbound transition
 * or be ignored as an already-active reselect.
 */
export function decideMoreTabBarPress(isMoreTabActive: boolean): MoreTabPressDecision {
  return isMoreTabActive ? "ignored" : "transition";
}
