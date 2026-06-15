import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * DEPRECATED (V1 cleanup, launch-blocker item #4).
 *
 * This was a duplicate LiveKit token endpoint with a weaker publish-authority
 * check (it granted publish to anyone whose role string contained "pastor").
 * It is not referenced by the mobile app or web; all live entry goes through
 * `/api/livekit/token`, which performs the proper publish-authority checks.
 *
 * To avoid leaving an orphan attack surface, this route now responds 410 Gone
 * for every method. Use `/api/livekit/token` instead.
 */
function gone() {
  return NextResponse.json(
    {
      ok: false,
      error: "Gone",
      details: { hint: "Use /api/livekit/token instead." },
    },
    { status: 410 }
  );
}

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
