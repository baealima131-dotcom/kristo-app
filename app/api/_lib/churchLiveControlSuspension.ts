import { NextResponse } from "next/server";
import { readLiveJsonFile } from "@/app/api/_lib/store/liveDb";

/** Same store and room the Church Live Control members route writes suspensions to. */
const STORE_FILE = "church-live-control-members.json";
export const CHURCH_LIVE_CONTROL_ROOM_ID = "church-media-room";

export const LIVE_CONTROL_SUSPENDED_ERROR = "live_control_suspended";

/**
 * True when the user is suspended from Church Live Control in this church. Read errors are
 * thrown (not treated as "not suspended") so callers fail closed.
 */
export async function isChurchLiveControlSuspended(churchId: string, userId: string): Promise<boolean> {
  const cid = String(churchId || "").trim();
  const uid = String(userId || "").trim();
  if (!cid || !uid) return false;
  const rows = await readLiveJsonFile<any[]>(STORE_FILE, []);
  return (Array.isArray(rows) ? rows : []).some(
    (row) =>
      String(row?.churchId || "") === cid &&
      String(row?.roomId || "") === CHURCH_LIVE_CONTROL_ROOM_ID &&
      String(row?.userId || "") === uid &&
      String(row?.status || "") === "Suspended"
  );
}

/**
 * A live/schedule id that belongs to Church Live Control (not a ministry room live). Same rule as
 * ministryRoomIdFromLiveId in liveScheduleAuthority (kept local: that module imports this one).
 */
export function isChurchLiveControlLiveId(liveId: string) {
  const lid = String(liveId || "").trim();
  return !(lid.startsWith("ministry_") && lid.slice("ministry_".length).trim());
}

/** Suspended in Church Live Control for this live; a read failure counts as suspended. */
export async function isSuspendedForChurchLive(churchId: string, userId: string, liveId: string) {
  if (!isChurchLiveControlLiveId(liveId)) return false;
  return isChurchLiveControlSuspended(churchId, userId).catch(() => true);
}

export function liveControlSuspendedResponse(self = true) {
  return NextResponse.json(
    {
      ok: false,
      error: LIVE_CONTROL_SUSPENDED_ERROR,
      message: self
        ? "Your Church Live Control access is suspended."
        : "This member is suspended from Church Live Control.",
    },
    { status: 403 }
  );
}

/**
 * Returns a 403 response when the user is suspended, a 503 when the suspension store cannot be
 * read, or null when the user may proceed.
 */
export async function denyIfLiveControlSuspended(
  churchId: string,
  userId: string,
  opts: { self?: boolean; source?: string } = {}
): Promise<NextResponse | null> {
  try {
    if (!(await isChurchLiveControlSuspended(churchId, userId))) return null;
  } catch (e) {
    console.log("KRISTO_LIVE_CONTROL_SUSPENSION_READ_FAILED", {
      source: opts.source || null,
      error: String((e as any)?.message || e),
    });
    return NextResponse.json(
      { ok: false, error: "Access check unavailable. Please try again later." },
      { status: 503 }
    );
  }
  console.log("KRISTO_LIVE_CONTROL_SUSPENDED_BLOCKED", {
    source: opts.source || null,
    churchId,
    userId,
    self: opts.self !== false,
  });
  return liveControlSuspendedResponse(opts.self !== false);
}
