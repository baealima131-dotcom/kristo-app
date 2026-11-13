import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

import {
  createYoutubeOAuthState,
  getYoutubeAnalyticsInvite,
  hashYoutubeOAuthValue,
} from "@/app/api/_lib/store/youtubeChannelOAuthDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorPage(message: string, status = 503) {
  return new NextResponse(
    `<!doctype html><html lang="sw"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kristo App · YouTube</title><body style="margin:0;background:#0b0d16;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;padding:28px;text-align:center"><h1 style="color:#f4d06f">YouTube Analytics</h1><p>${message.replace(/[<>]/g, "")}</p></main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function GET(req: NextRequest) {
  const invite = String(req.nextUrl.searchParams.get("invite") || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(invite)) return errorPage("Mwaliko haukubaliki au umeisha muda wake.", 400);

  const clientId = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || "").trim();
  const redirectUri = String(process.env.YOUTUBE_OAUTH_REDIRECT_URI || "").trim();
  if (!clientId || !redirectUri) return errorPage("Muunganisho wa Google haujawekwa tayari. Tafadhali wasiliana na System Admin.");

  try {
    const inviteHash = hashYoutubeOAuthValue(invite);
    const savedInvite = await getYoutubeAnalyticsInvite(inviteHash);
    if (!savedInvite) return errorPage("Mwaliko huu umetumika, umeisha muda wake, au si sahihi.", 410);

    const state = randomBytes(32).toString("base64url");
    await createYoutubeOAuthState(hashYoutubeOAuthValue(state), inviteHash);

    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.searchParams.set("client_id", clientId);
    google.searchParams.set("redirect_uri", redirectUri);
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ].join(" "));
    google.searchParams.set("access_type", "offline");
    google.searchParams.set("prompt", "consent");
    google.searchParams.set("include_granted_scopes", "true");
    google.searchParams.set("state", state);
    return NextResponse.redirect(google.toString(), { status: 302 });
  } catch {
    return errorPage("Imeshindikana kuanza idhini ya YouTube. Jaribu tena baadaye.", 503);
  }
}
