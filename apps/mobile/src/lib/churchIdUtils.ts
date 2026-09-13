export function churchIdsMatch(a: string, b: string) {
  return String(a || "").trim().toUpperCase() ===
    String(b || "").trim().toUpperCase();
}
