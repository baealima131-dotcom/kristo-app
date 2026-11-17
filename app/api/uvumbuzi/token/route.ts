import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * The signed Lab token is SERVER-ONLY. Kristo phones must call the
 * authenticated /api/uvumbuzi/lab/* relay instead of receiving a bearer that
 * could bypass Kristo-side route restrictions and audit logging.
 *
 * Intentionally keep the route as a non-functional tombstone during rollout:
 * older clients fail closed. Do not deploy until callers have been audited.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Use the Kristo UVUMBUZI Lab relay", reason: "relay_only" },
    { status: 404, headers: { "Cache-Control": "no-store" } }
  );
}
