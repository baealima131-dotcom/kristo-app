import { NextResponse } from "next/server";

import { resolveVerifiedUserId } from "@/app/api/_lib/verifiedChurchActor";
import {
  PERSON_RELATIONS_MAX_IDS,
  resolvePersonRingCategories,
} from "@/app/api/_lib/personRelations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/people/relations?userIds=a,b,c
 * For the signed-in viewer: each person's avatar-ring category (pastor / member of the viewer's
 * church or of another church, or "unknown"), from active memberships only. Returns categories
 * only — never church ids — for at most PERSON_RELATIONS_MAX_IDS people.
 */
export async function GET(req: Request) {
  const viewerOrRes = await resolveVerifiedUserId(req);
  if (viewerOrRes instanceof NextResponse) return viewerOrRes;

  const { searchParams } = new URL(req.url);
  const userIds = String(searchParams.get("userIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (userIds.length > PERSON_RELATIONS_MAX_IDS) {
    return NextResponse.json(
      { ok: false, error: `At most ${PERSON_RELATIONS_MAX_IDS} userIds.` },
      { status: 400 }
    );
  }

  const categories = await resolvePersonRingCategories(viewerOrRes, userIds);
  return NextResponse.json(
    { ok: true, data: categories },
    { headers: { "cache-control": "no-store" } }
  );
}
