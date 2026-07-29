/**
 * Shared Create Ministry navigation timing diagnostics (dev-friendly).
 * Never stores secrets or PII beyond timestamps.
 */

let createMinistryPressAtMs = 0;

export function markCreateMinistryPress(source: string): number {
  createMinistryPressAtMs = Date.now();
  console.log("KRISTO_CREATE_MINISTRY_PRESS", {
    source: String(source || "").trim() || "unknown",
    atMs: createMinistryPressAtMs,
  });
  return createMinistryPressAtMs;
}

export function getCreateMinistryPressAtMs(): number {
  return createMinistryPressAtMs;
}

export function msFromCreateMinistryPress(now = Date.now()): number | null {
  if (!createMinistryPressAtMs) return null;
  return Math.max(0, now - createMinistryPressAtMs);
}

export function isCreateMinistryRoute(pathnameOrSegments: string | string[] | null | undefined): boolean {
  if (Array.isArray(pathnameOrSegments)) {
    const joined = pathnameOrSegments.map((s) => String(s || "")).join("/");
    return /ministries\/create\b/i.test(joined) || (pathnameOrSegments.includes("ministries") && pathnameOrSegments.includes("create"));
  }
  const path = String(pathnameOrSegments || "");
  return /ministries\/create\b/i.test(path);
}
