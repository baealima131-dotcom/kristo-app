import { NextResponse } from "next/server";
import { getChurchById, isChurchOpen } from "@/app/api/_lib/churches";

/**
 * Server gate for churches created through a church application. A church whose
 * activationStatus is "pending_requirements" (also while its application is expired) or
 * "closed" (rejected) is not open: church-scoped APIs refuse it. Churches without the field
 * (every existing church) and "active" ones are unaffected.
 *
 * While a church is not open only the activation workflow itself is allowed: membership and
 * join requests / invites (to reach the member requirement), the member list, notifications
 * (application decisions) and the application API. Its own members may also READ the data the
 * Church Overview shows (profile, overview stats, ministries list, media hosts, live-control
 * status); every write there (posts, ministries, media, live, profile edits) stays refused.
 */
export const CHURCH_NOT_ACTIVE_ERROR = "church_not_active";

const PENDING_ALLOWED_PREFIXES = [
  "/api/church/applications",
  "/api/church/join-requests",
  "/api/church/membership",
  "/api/church/memberships",
  "/api/church/invites",
  "/api/church/members",
  "/api/church/notifications",
];

/** Read-only (GET) while pending: what the normal Church Overview loads. */
const PENDING_READ_ONLY_PATHS = [
  "/api/church/overview",
  "/api/church/profile",
  "/api/church/ministries",
  "/api/church/media-hosts",
  "/api/church/live-control-members",
];

export function isAllowedWhileChurchPending(pathname: string, method = "GET", status = "pending_requirements") {
  const path = String(pathname || "").replace(/\/+$/, "");
  // Overview reads: only while the church is still being built up (pending, also when expired);
  // a rejected (closed) church gets no church reads.
  if (status === "pending_requirements" && method.toUpperCase() === "GET" && PENDING_READ_ONLY_PATHS.includes(path)) return true;
  if (path === "/api/church/notifications/dev-create") return false;
  // The member list is read-only while pending; member management (roles) stays closed.
  if (path === "/api/church/members" && method.toUpperCase() !== "GET") return false;
  return PENDING_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { open: boolean; status: string; at: number }>();

/** Clears the cached state after an activation-status change in this process. */
export function invalidateChurchActivationCache(churchId?: string) {
  if (churchId) cache.delete(String(churchId).trim().toUpperCase());
  else cache.clear();
}

export async function getChurchActivationState(churchId: string): Promise<{ open: boolean; status: string }> {
  const id = String(churchId || "").trim().toUpperCase();
  if (!id) return { open: true, status: "none" };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const church = await getChurchById(id);
  // A church id without a church record (legacy/demo rows) is treated as before: open.
  const state = { open: !church || isChurchOpen(church), status: String(church?.activationStatus || "active") };
  cache.set(id, { ...state, at: Date.now() });
  return state;
}

export async function isChurchOpenById(churchId: string) {
  return (await getChurchActivationState(churchId)).open;
}

export function churchNotActiveResponse(status: string) {
  return NextResponse.json(
    {
      ok: false,
      error: CHURCH_NOT_ACTIVE_ERROR,
      message: "This church is not active yet. It opens when Kristo App activates it.",
      details: { activationStatus: status },
    },
    { status: 403 }
  );
}

/**
 * Returns a 403 when `churchId` is not open and the route is not part of the activation
 * workflow; null otherwise. Read failures fail closed (503) so a pending church is never let
 * through by accident.
 */
export async function denyIfChurchNotActive(
  churchId: string,
  req: { url: string; method?: string },
  source: string
): Promise<NextResponse | null> {
  if (!churchId) return null;
  let pathname = "";
  try {
    pathname = new URL(req.url).pathname;
  } catch {}
  let state: { open: boolean; status: string };
  try {
    state = await getChurchActivationState(churchId);
  } catch (e) {
    console.log("KRISTO_CHURCH_ACTIVATION_READ_FAILED", { source, churchId, error: String((e as any)?.message || e) });
    return NextResponse.json({ ok: false, error: "Church check unavailable. Please try again." }, { status: 503 });
  }
  if (state.open) return null;
  if (isAllowedWhileChurchPending(pathname, req.method, state.status)) return null;
  console.log("KRISTO_CHURCH_NOT_ACTIVE_BLOCKED", { source, churchId, status: state.status, path: pathname, method: req.method });
  return churchNotActiveResponse(state.status);
}
