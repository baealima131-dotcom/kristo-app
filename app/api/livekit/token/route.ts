import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";

function auth(req: Request) {
  return {
    userId: String(req.headers.get("x-kristo-user-id") || "").trim(),
    role: String(req.headers.get("x-kristo-role") || "").trim(),
    churchId: String(req.headers.get("x-kristo-church-id") || "").trim(),
  };
}

function canPublish(role: string) {
  const r = String(role || "").toLowerCase();
  return r.includes("pastor") || r.includes("admin") || r.includes("leader") || r.includes("host");
}

export async function POST(req: Request) {
  try {
    const a = auth(req);

    if (!a.userId || !a.churchId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const roomName = String(body.roomName || body.liveId || `church-live-${a.churchId}`).trim();

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({
        ok: false,
        error: "Missing LiveKit env",
        hasUrl: !!livekitUrl,
        hasKey: !!apiKey,
        hasSecret: !!apiSecret,
      }, { status: 500 });
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: String(body.identity || a.userId),
      name: String(body.name || a.userId || a.role || "Kristo User"),
    });

    const wantsPublish = body.canPublish === true;
    const headerMayPublish =
      String(req.headers.get("x-kristo-live-may-publish") || "").trim() === "1";
    const allowedToPublish =
      wantsPublish && (canPublish(a.role) || headerMayPublish);

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canSubscribe: true,
      // SECURITY: client request alone must never grant publish.
      // User must request publish AND server role check must allow it.
      canPublish: allowedToPublish,
      canPublishData: true,
    });

    return NextResponse.json({
      ok: true,
      url: livekitUrl,
      token: await token.toJwt(),
      roomName,
    });
  } catch (e: any) {
    console.error("KRISTO_LIVEKIT_TOKEN_ROUTE_ERROR", e);
    return NextResponse.json({
      ok: false,
      error: "LiveKit token route crashed",
      message: String(e?.message || e),
      name: String(e?.name || ""),
    }, { status: 500 });
  }
}

