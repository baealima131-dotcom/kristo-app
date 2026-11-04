import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export const CHURCH_LIVE_CONTROL_ROOM_ID = "church-media-room";

/** Error code the server returns (403) when a Church Live Control suspended member is blocked. */
export const LIVE_CONTROL_SUSPENDED_ERROR = "live_control_suspended";

export type LiveControlSelfStatus = "Active" | "Suspended";

/** Last status seen this session, per user, so screens can render without waiting. */
const lastKnown = new Map<string, LiveControlSelfStatus>();

export function lastKnownLiveControlStatus(userId: string): LiveControlSelfStatus | null {
  return lastKnown.get(String(userId || "").trim()) || null;
}

export function rememberLiveControlStatus(userId: string, status: LiveControlSelfStatus) {
  const uid = String(userId || "").trim();
  if (uid) lastKnown.set(uid, status);
}

export function isLiveControlSuspendedError(res: any) {
  return String(res?.error || "") === LIVE_CONTROL_SUSPENDED_ERROR;
}

/**
 * The viewer's own Church Live Control status from the server, or null when it could not be
 * read (offline / server error). The server enforces suspension either way; this only drives
 * the UI.
 */
export async function fetchLiveControlSelfStatus(userId: string): Promise<LiveControlSelfStatus | null> {
  const uid = String(userId || "").trim();
  try {
    const res = await apiGet<any>(
      `/api/church/live-control-members?roomId=${encodeURIComponent(CHURCH_LIVE_CONTROL_ROOM_ID)}`,
      { headers: getKristoHeaders() as any },
      { screen: "LiveControlSelfStatus", throttleMs: 0, dedupe: false }
    );
    if (!res || res.ok === false) return null;

    let status: LiveControlSelfStatus = "Active";
    const selfStatus = String(res?.self?.liveControlStatus || res?.self?.status || "").trim();
    if (selfStatus === "Suspended" || selfStatus === "Active") {
      status = selfStatus;
    } else {
      const rows = Array.isArray(res?.data) ? res.data : [];
      const mine = rows.find((row: any) => String(row?.userId || "") === uid);
      const rowStatus = String(mine?.liveControlStatus || mine?.status || "Active").trim();
      status = rowStatus === "Suspended" ? "Suspended" : "Active";
    }
    rememberLiveControlStatus(uid, status);
    return status;
  } catch {
    return null;
  }
}
