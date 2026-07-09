import { NextResponse } from "next/server";
import { getUserById, readSession, touchUser } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

function presenceText(lastSeenAt: number, now: number) {
  const ageMs = Math.max(0, now - Number(lastSeenAt || 0));
  if (lastSeenAt > 0 && ageMs <= 60_000) return "online now";
  if (!lastSeenAt) return "last seen recently";

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

  await touchUser(viewerUserId).catch(() => null);

  const url = new URL(req.url);
  const targetUserId = String(url.searchParams.get("userId") || viewerUserId).trim();
  const user = await getUserById(targetUserId);

  const now = Date.now();
  const lastSeenAt = Number(user?.lastSeenAt || 0);
  const online = lastSeenAt > 0 && now - lastSeenAt <= 60_000;

  return NextResponse.json({
    ok: true,
    data: {
      userId: targetUserId,
      online,
      lastSeenAt,
      serverNow: now,
      text: presenceText(lastSeenAt, now),
    },
  });
}
