export function normalizeAvatarUpdatedAt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function isEphemeralAvatarUri(uri: unknown) {
  const u = String(uri || "").trim();
  return u.startsWith("file:") || /^data:image\//i.test(u);
}

export function isPersistedAvatarUri(uri: unknown) {
  const u = String(uri || "").trim();
  if (!u || isEphemeralAvatarUri(u)) return false;
  return /^https?:\/\//i.test(u) || u.startsWith("/uploads/") || u.startsWith("/");
}

export function pickFresherAvatar(opts: {
  localUri?: string;
  localUpdatedAt?: number;
  serverUri?: string;
  serverUpdatedAt?: number;
}): { uri: string; skippedStale: boolean; source: "local" | "server" | "none" } {
  const local = String(opts.localUri || "").trim();
  const server = String(opts.serverUri || "").trim();
  const localAt = normalizeAvatarUpdatedAt(opts.localUpdatedAt);
  const serverAt = normalizeAvatarUpdatedAt(opts.serverUpdatedAt);

  if (!local && !server) return { uri: "", skippedStale: false, source: "none" };
  if (!server) return { uri: local, skippedStale: false, source: "local" };
  if (!local) return { uri: server, skippedStale: false, source: "server" };

  if (isPersistedAvatarUri(server) && isEphemeralAvatarUri(local)) {
    return { uri: server, skippedStale: local !== server, source: "server" };
  }

  if (localAt > serverAt) {
    return { uri: local, skippedStale: local !== server, source: "local" };
  }
  if (serverAt > localAt) {
    return { uri: server, skippedStale: false, source: "server" };
  }

  if (local !== server) {
    if (isPersistedAvatarUri(server) && !isPersistedAvatarUri(local)) {
      return { uri: server, skippedStale: false, source: "server" };
    }
    return { uri: local, skippedStale: true, source: "local" };
  }

  return { uri: server, skippedStale: false, source: "server" };
}

export function mergeChurchAvatarForDisplay(opts: {
  churchId: string;
  localUri?: string;
  localUpdatedAt?: number;
  serverUri?: string;
  serverUpdatedAt?: number;
  /** When true, server wins if serverUpdatedAt >= localUpdatedAt (church overview server truth). */
  preferServer?: boolean;
}) {
  const local = String(opts.localUri || "").trim();
  const server = String(opts.serverUri || "").trim();
  const localAt = normalizeAvatarUpdatedAt(opts.localUpdatedAt);
  const serverAt = normalizeAvatarUpdatedAt(opts.serverUpdatedAt);

  let merged = pickFresherAvatar({
    localUri: opts.localUri,
    localUpdatedAt: opts.localUpdatedAt,
    serverUri: opts.serverUri,
    serverUpdatedAt: opts.serverUpdatedAt,
  });

  if (opts.preferServer && server && serverAt >= localAt) {
    merged = { uri: server, skippedStale: local !== server, source: "server" };
  }


  const cachedUri = String(opts.localUri || "").trim();
  const uriKind: "data" | "remote" | "empty" = !cachedUri
    ? "empty"
    : /^data:image/i.test(cachedUri)
      ? "data"
      : "remote";

  console.log("KRISTO_CHURCH_AVATAR_CACHE_APPLY", {
    churchId: opts.churchId,
    hasCachedAvatar: Boolean(cachedUri),
    uriKind,
  });

  return merged;
}

export function avatarCacheBust(uri: string, updatedAt?: number): string {
  const u = String(uri || "").trim();
  if (!u || !updatedAt) return u;
  if (u.startsWith("file:") || /^data:image\//i.test(u)) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${updatedAt}`;
}

/**
 * Stable avatar identity for compare — strips cache-bust `t=` (and common
 * ephemeral query noise) so the same asset is not treated as a new URI.
 * Never log the returned value in production diagnostics that include URLs.
 */
export function normalizeAvatarIdentity(uri: unknown): string {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (raw.startsWith("file:") || /^data:image\//i.test(raw)) return raw;
  try {
    const noHash = raw.split("#")[0] || raw;
    const [base, query = ""] = noHash.split("?");
    if (!query) return noHash;
    const kept = query
      .split("&")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^t=\d+$/i.test(part));
    return kept.length ? `${base}?${kept.join("&")}` : String(base || "");
  } catch {
    return raw.replace(/([?&])t=\d+/gi, "").replace(/\?&/, "?").replace(/\?$/, "");
  }
}

export function areAvatarIdentitiesEqual(a: unknown, b: unknown): boolean {
  return normalizeAvatarIdentity(a) === normalizeAvatarIdentity(b);
}

export type ProfileAvatarRefreshDecision = "unchanged" | "changed" | "preserved-on-error";

export function decideProfileAvatarRefresh(opts: {
  previousUri?: string | null;
  nextUri?: string | null;
  responseOk: boolean;
}): ProfileAvatarRefreshDecision {
  if (!opts.responseOk) return "preserved-on-error";
  const prev = normalizeAvatarIdentity(opts.previousUri);
  const next = normalizeAvatarIdentity(opts.nextUri);
  if (prev && next && prev === next) return "unchanged";
  if (!prev && !next) return "unchanged";
  return "changed";
}
