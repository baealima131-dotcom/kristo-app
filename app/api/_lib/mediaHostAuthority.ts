export function canManageTrustedHosts(requesterUserId: string, actualPastorUserId: string, activeChurchRole?: string): boolean {
  const requester = String(requesterUserId || "").trim().toLowerCase();
  const pastor = String(actualPastorUserId || "").trim().toLowerCase();
  return Boolean(requester && ((pastor && requester === pastor) || activeChurchRole === "Church_Admin"));
}
