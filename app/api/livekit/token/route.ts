import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { assertSafetyEnforcementAllows } from "@/app/api/_lib/rbac";
import { resolveVerifiedChurchActor } from "@/app/api/_lib/verifiedChurchActor";
import { resolvePublicDisplayName } from "@/app/api/_lib/publicDisplayName";
import {
  canDriveLiveSchedule,
  isServerActiveSlotOwner,
  readChurchSchedule,
} from "@/app/api/_lib/liveScheduleAuthority";
import { readLiveJsonFile } from "@/app/api/_lib/store/liveDb";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed", hint: "POST with Kristo auth headers and roomName." },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  try {
    // Identity, church and role come from the verified session + membership (checked as a read
    // here; publish rights are checked again below), never from x-kristo-* headers.
    const actor = await resolveVerifiedChurchActor(req, "livekit-token", { safetyMethod: "GET" });
    if (actor instanceof NextResponse) return actor;
    const a = { userId: actor.userId, role: actor.churchRole, churchId: actor.churchId };

    const body = await req.json().catch(() => ({}));
    const roomName = String(body.roomName || body.liveId || `church-live-${a.churchId}`).trim();

    // The room must be a live session or schedule of the caller's own church.
    const liveStore = await readLiveJsonFile<Record<string, any>>("church-live.json", {});
    const liveRecord = liveStore[`${a.churchId}|${roomName}`] || null;
    const schedule = await readChurchSchedule(a.churchId, roomName);
    if (!liveRecord && !schedule.known && roomName !== `church-live-${a.churchId}`) {
      return NextResponse.json({ ok: false, error: "Forbidden (room)" }, { status: 403 });
    }

    // Publish: schedule drivers (pastor/leader/admin roles, live moderators, media hosts,
    // ministry leaders), a member holding a slot in this schedule, the server's active slot owner,
    // or a guest approved on stage. x-kristo-live-may-publish and the role header are ignored.
    const wantsPublish = body.canPublish === true;
    const approvedOnStage = Object.values((liveRecord?.requests as Record<string, any>) || {}).some(
      (r: any) => String(r?.userId || "") === a.userId && r?.approved === true && r?.onStage !== false
    );
    const allowedToPublish =
      wantsPublish &&
      ((await canDriveLiveSchedule(a, liveRecord, roomName)) ||
        schedule.cards.some((card: any) => String(card?.claimedByUserId || "") === a.userId) ||
        (!!liveRecord && isServerActiveSlotOwner(liveRecord, a.userId, Date.now())) ||
        approvedOnStage);

    /*
     * Suspended / permanently banned: block every token (read as
     * "POST" so all methods are denied by the canonical gate).
     * Restricted: block publish-capable tokens only; allow an
     * explicit viewer-only (subscribe) token so lite viewing is
     * not cut off. Publish is never granted from client claims alone.
     */
    const safetyMethod =
      allowedToPublish ? "POST" : "GET";
    const safetyBlocked =
      await assertSafetyEnforcementAllows(
        a.userId,
        safetyMethod
      );
    if (safetyBlocked) {
      return safetyBlocked;
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing LiveKit env",
          hasUrl: !!livekitUrl,
          hasKey: !!apiKey,
          hasSecret: !!apiSecret,
        },
        { status: 500 }
      );
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: a.userId,
      name: await resolvePublicDisplayName(a.userId, "Kristo User"),
    });

    console.log("KRISTO_LIVEKIT_TOKEN_REQUEST", {
      userId: a.userId,
      role: a.role,
      churchId: a.churchId,
      roomName,
      wantsPublish,
      allowedToPublish,
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canSubscribe: true,
      // SECURITY: client request alone must never grant publish.
      canPublish: allowedToPublish,
      canPublishData: true,
    });

    return NextResponse.json({
      ok: true,
      url: livekitUrl,
      token: await token.toJwt(),
      roomName,
      canPublish: allowedToPublish,
    });
  } catch (e: any) {
    console.error("KRISTO_LIVEKIT_TOKEN_ROUTE_ERROR", e);
    return NextResponse.json(
      {
        ok: false,
        error: "LiveKit token route crashed",
        message: String(e?.message || e),
        name: String(e?.name || ""),
      },
      { status: 500 }
    );
  }
}
