export function pickFresherAvatar(opts: {
  localUri?: string;
  localUpdatedAt?: number;
  serverUri?: string;
  serverUpdatedAt?: number;
}): { uri: string; skippedStale: boolean; source: "local" | "server" | "none" } {
  const local = String(opts.localUri || "").trim();
  const server = String(opts.serverUri || "").trim();
  const localAt = Number(opts.localUpdatedAt || 0);
  const serverAt = Number(opts.serverUpdatedAt || 0);

  if (!local && !server) return { uri: "", skippedStale: false, source: "none" };
  if (!server) return { uri: local, skippedStale: false, source: "local" };
  if (!local) return { uri: server, skippedStale: false, source: "server" };

  if (localAt > serverAt) {
    return { uri: local, skippedStale: local !== server, source: "local" };
  }
  if (serverAt > localAt) {
    return { uri: server, skippedStale: false, source: "server" };
  }

  if (local !== server) {
    return { uri: local, skippedStale: true, source: "local" };
  }

  return { uri: server, skippedStale: false, source: "server" };
}

export function avatarCacheBust(uri: string, updatedAt?: number): string {
  const u = String(uri || "").trim();
  if (!u || !updatedAt) return u;
  if (u.startsWith("file:") || /^data:image\//i.test(u)) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${updatedAt}`;
}
