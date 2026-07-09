import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { readSession } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

const STORE_FILE = "message-presence.json";
const ONLINE_WINDOW_MS = 10_000;

type PresenceStore = Record<string, Record<string, number>>;

function presenceText(lastSeenAt: number, now: number) {
  if (!lastSeenAt) return "offline";
  const ageMs = Math.max(0, now - lastSeenAt);
  if (ageMs <= ONLINE_WINDOW_MS) return "online now";

  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return "last seen just now";
  if (min < 60) return `last seen ${min} min ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `last seen ${hr}h ago`;

  const days = Math.floor(hr / 24);
  return `last seen ${days}d ago`;
}

export async function GET(req: Request) {
  const session = await readSession(req);
  const viewerUserId = String(session?.userId || "").trim();
  if (!viewerUserId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const roomId = String(url.searchParams.get("roomId") || "").trim();
  const targetUserId = String(url.searchParams.get("userId") || "").trim();
  const heartbeat = String(url.searchParams.get("heartbeat") || "") === "1";
  const now = Date.now();

  if (!roomId || !targetUserId) {
    return NextResponse.json({
      ok: true,
      data: {
        userId: targetUserId,
        online: false,
        lastSeenAt: 0,
        serverNow: now,
        text: "offline",
      },
    });
  }

  const store = await readJsonFile<PresenceStore>(STORE_FILE, {});

  if (heartbeat) {
    store[roomId] = { ...(store[roomId] || {}), [viewerUserId]: now };
    await writeJsonFile(STORE_FILE, store);
  }

  const lastSeenAt = Number(store?.[roomId]?.[targetUserId] || 0);
  const online = lastSeenAt > 0 && now - lastSeenAt <= ONLINE_WINDOW_MS;

  return NextResponse.json({
    ok: true,
    data: {
      userId: targetUserId,
      roomId,
      online,
      lastSeenAt,
      serverNow: now,
      text: presenceText(lastSeenAt, now),
    },
  });
}
