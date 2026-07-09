import { NextResponse } from "next/server";
import { readSession } from "@/app/api/auth/_lib/session";
import {
  getMessagePresenceLastSeen,
  touchMessagePresence,
} from "@/app/api/_lib/store/messagePresenceDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONLINE_WINDOW_MS = 20_000;
const MESSAGE_LIST_ROOM = "__messages_list__";

function text(lastSeenAt: number, now: number) {
  if (!lastSeenAt) return "last seen recently";

  const ageMs = Math.max(0, now - lastSeenAt);

  if (ageMs <= ONLINE_WINDOW_MS) return "online now";

  const min = Math.floor(ageMs / 60_000);

  if (min < 1) return "last seen just now";
  if (min < 60) return `last seen ${min} min ago`;

  const hr = Math.floor(min / 60);

  if (hr < 24) return `last seen ${hr}h ago`;

  return `last seen ${Math.floor(hr / 24)}d ago`;
}

export async function GET(req: Request) {
  const session = await readSession(req);
  const viewerUserId = String(session?.userId || "").trim();

  if (!viewerUserId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const url = new URL(req.url);

  const roomId = String(url.searchParams.get("roomId") || "").trim();
  const targetUserId = String(url.searchParams.get("userId") || "").trim();
  const heartbeat = url.searchParams.get("heartbeat") === "1";
  const now = Date.now();

  if (heartbeat) {
    const contextKey = roomId || MESSAGE_LIST_ROOM;

    await touchMessagePresence(
      contextKey,
      viewerUserId,
      now
    );
  }

  if (!targetUserId) {
    return NextResponse.json(
      {
        ok: true,
        data: {
          online: true,
          text: "online now",
          serverNow: now,
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const contextKeys = [
    MESSAGE_LIST_ROOM,
    ...(roomId ? [roomId] : []),
  ];

  const lastSeenAt = await getMessagePresenceLastSeen(
    targetUserId,
    contextKeys
  );

  const online =
    lastSeenAt > 0 &&
    now - lastSeenAt <= ONLINE_WINDOW_MS;

  return NextResponse.json(
    {
      ok: true,
      data: {
        userId: targetUserId,
        roomId,
        online,
        lastSeenAt,
        serverNow: now,
        text: text(lastSeenAt, now),
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
