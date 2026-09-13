export function isPastorSessionRole(role?: string) {
  return String(role || "").toLowerCase().includes("pastor");
}
