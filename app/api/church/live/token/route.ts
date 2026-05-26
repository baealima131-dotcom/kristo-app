import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";

function auth(req: Request) {
  return {
    userId: String(req.headers.get("x-kristo-user-id") || "").trim(),
    role: String(req.headers.get("x-kristo-role") || "Member").trim(),
    churchId: String(req.headers.get("x-kristo-church-id") || "").trim(),
  };
}

export async function POST(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const roomName = String(body.roomName || body.liveId || `church-${a.churchId}`).trim();

  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  const livekitUrl = process.env.LIVEKIT_URL || "";

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { ok: false, error: "LiveKit env missing" },
      { status: 500 }
    );
  }

  const isPastor = a.role.toLowerCase().includes("pastor");

  const at = new AccessToken(apiKey, apiSecret, {
    identity: a.userId,
    name: isPastor ? "Pastor" : "Viewer",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: isPastor,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({
    ok: true,
    url: livekitUrl,
    token,
    roomName,
    canPublish: isPastor,
  });
}
