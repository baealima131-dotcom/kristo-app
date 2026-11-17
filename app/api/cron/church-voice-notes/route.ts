import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sweepExpiredChurchMembersVoiceNotes } from "@/app/api/_lib/churchMembersRoomPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled cleanup (Vercel Cron, see vercel.json): deletes Church Members voice notes and their
 * audio files 7 days after they were sent, even if nobody opens the room. Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET configured the route refuses to run.
 */
function isAuthorized(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.get("authorization") || ""));
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!String(process.env.CRON_SECRET || "").trim()) {
    return NextResponse.json({ ok: false, error: "Cron is not configured." }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await sweepExpiredChurchMembersVoiceNotes(Date.now());
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.log("KRISTO_CHURCH_MEMBERS_VOICE_NOTES_SWEEP_FAILED", { error: String(e?.message || e) });
    return NextResponse.json({ ok: false, error: "Voice note cleanup failed." }, { status: 500 });
  }
}
