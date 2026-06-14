/** Demo/dev church IDs that must not block real user flows unless explicitly enabled. */
export const BLOCKED_DEMO_CHURCH_IDS = new Set([
  "church_dev_default",
  "c-demo-1",
  "c-demo-2",
  "c-demo-3",
  "c1",
  "c2",
  "c_mn7wv2x2_zu0n9g",
]);

export function devAutoMembershipEnabled() {
  const v = String(process.env.KRISTO_DEV_AUTO_MEMBERSHIP || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isBlockedDemoChurchId(churchId?: string | null): boolean {
  const id = String(churchId || "").trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (BLOCKED_DEMO_CHURCH_IDS.has(id) || BLOCKED_DEMO_CHURCH_IDS.has(lower)) return true;
  if (/^c-demo-/i.test(id)) return true;
  if (/^church_demo_/i.test(id)) return true;
  return false;
}

/** Whether an active membership in this church should count for guards and session sync. */
export function countsAsRealActiveMembership(churchId?: string | null): boolean {
  const id = String(churchId || "").trim();
  if (!id) return false;
  return !isBlockedDemoChurchId(id);
}

export const STALE_DEMO_MEMBERSHIP_NOTE = "auto-deactivated stale demo membership";
