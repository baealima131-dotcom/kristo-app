import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { getFeedItemById } from "@/app/api/_lib/store/feedDb";
import {
  createYoutubeAnalyticsInvite,
  hashYoutubeOAuthValue,
  listConnectedYoutubeChannelIds,
} from "@/app/api/_lib/store/youtubeChannelOAuthDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appOrigin() {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const vercel = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  const raw = configured || (vercel ? `https://${vercel}` : "https://kristo-app.vercel.app");
  const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error("Application URL must use HTTPS.");
  return url.origin;
}

export async function GET(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ ok: true, connectedChannelIds: await listConnectedYoutubeChannelIds() });
  } catch {
    return NextResponse.json({ ok: false, error: "YouTube channel status is unavailable." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const videoItemId = String(body?.videoItemId || "").trim();
  if (!videoItemId || videoItemId.length > 180) {
    return NextResponse.json({ ok: false, error: "Video link is required." }, { status: 400 });
  }

  try {
    const item: any = await getFeedItemById(videoItemId);
    const provider = String(item?.videoDisplayType || item?.provider || "").toLowerCase();
    const channelId = String(item?.creatorId || "").trim();
    if (
      !item ||
      String(item?.source || "") !== "system-admin-video-link" ||
      provider !== "youtube" ||
      !channelId
    ) {
      return NextResponse.json({ ok: false, error: "This video has no connectable YouTube channel." }, { status: 422 });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashYoutubeOAuthValue(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await createYoutubeAnalyticsInvite({
      tokenHash,
      videoId: String(item?.videoId || item?.externalVideoId || ""),
      channelId,
      creatorName: String(item?.creatorName || "YouTube channel").slice(0, 140),
      createdBy: String(auth.viewer.userId || "system-admin"),
      expiresAt,
    });

    const url = new URL("/youtube/connect", appOrigin());
    url.searchParams.set("invite", token);
    return NextResponse.json({
      ok: true,
      connectUrl: url.toString(),
      expiresAt,
      creatorName: String(item?.creatorName || "YouTube channel"),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || "Could not create channel invitation.") }, { status: 503 });
  }
}
