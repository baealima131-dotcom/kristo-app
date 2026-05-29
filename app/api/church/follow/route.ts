import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countChurchFollowers,
  countMutualFollowersFromChurch,
  isFollowingChurch,
  toggleChurchFollow,
} from "@/app/api/_lib/churchFollows";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function header(req: NextRequest, name: string) {
  return String(req.headers.get(name) || "").trim();
}

export async function GET(req: NextRequest) {
  const userId = header(req, "x-kristo-user-id");
  const url = new URL(req.url);
  const churchId = String(url.searchParams.get("churchId") || "").trim();
  const viewerChurchId = String(
    url.searchParams.get("viewerChurchId") || header(req, "x-kristo-church-id") || ""
  ).trim();

  if (!churchId) {
    return json({ ok: false, error: "churchId missing" }, { status: 400 });
  }

  const [following, followerCount, mutualFollowersFromViewerChurch] = await Promise.all([
    userId ? isFollowingChurch(userId, churchId) : Promise.resolve(false),
    countChurchFollowers(churchId),
    viewerChurchId && viewerChurchId !== churchId
      ? countMutualFollowersFromChurch({ targetChurchId: churchId, viewerChurchId })
      : Promise.resolve(0),
  ]);

  return json({
    ok: true,
    data: {
      churchId,
      following,
      followerCount,
      mutualFollowersFromViewerChurch,
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = header(req, "x-kristo-user-id");
  if (!userId) {
    return json({ ok: false, error: "userId missing" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const churchId = String(body?.churchId || "").trim();
  const viewerChurchId = String(
    body?.viewerChurchId || header(req, "x-kristo-church-id") || ""
  ).trim();

  if (!churchId) {
    return json({ ok: false, error: "churchId missing" }, { status: 400 });
  }

  const result = await toggleChurchFollow({ userId, churchId, viewerChurchId });
  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 400 });
  }

  const mutualFollowersFromViewerChurch =
    viewerChurchId && viewerChurchId !== churchId
      ? await countMutualFollowersFromChurch({ targetChurchId: churchId, viewerChurchId })
      : 0;

  return json({
    ok: true,
    data: {
      churchId,
      following: result.following,
      followerCount: result.followerCount,
      mutualFollowersFromViewerChurch,
    },
  });
}
