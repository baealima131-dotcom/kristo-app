import { NextRequest, NextResponse } from "next/server";
import {
  completeYoutubeAnalyticsInvite,
  consumeYoutubeOAuthState,
  getYoutubeAnalyticsInvite,
  hashYoutubeOAuthValue,
} from "@/app/api/_lib/store/youtubeChannelOAuthDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, message: string, status = 200) {
  const safeTitle = title.replace(/[<>]/g, "");
  const safeMessage = message.replace(/[<>]/g, "");
  return new NextResponse(
    `<!doctype html><html lang="sw"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><body style="margin:0;background:#0b0d16;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:540px;padding:28px;text-align:center"><div style="font-size:38px;color:#f4d06f">✦</div><h1 style="color:#f4d06f">${safeTitle}</h1><p style="line-height:1.6;color:#d0d1da">${safeMessage}</p></main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get("code") || "");
  const state = String(req.nextUrl.searchParams.get("state") || "");
  const oauthError = String(req.nextUrl.searchParams.get("error") || "");
  if (oauthError) return page("Idhini haikukamilika", "Hujaruhusu Kristo App kusoma takwimu za channel. Unaweza kujaribu tena kwa kutumia link ya mwaliko.", 400);
  if (!code || !/^[A-Za-z0-9_-]{40,60}$/.test(state)) return page("Link haijakamilika", "Google haikurudisha taarifa zote zinazohitajika.", 400);

  try {
    const inviteHash = await consumeYoutubeOAuthState(hashYoutubeOAuthValue(state));
    if (!inviteHash) return page("Idhini imeisha muda", "Fungua tena link ya mwaliko uliyotumiwa.", 410);
    const invite = await getYoutubeAnalyticsInvite(inviteHash);
    if (!invite) return page("Mwaliko haupatikani", "Mwaliko umetumika au umeisha muda wake.", 410);

    const clientId = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "").trim();
    const redirectUri = String(process.env.YOUTUBE_OAUTH_REDIRECT_URI || "").trim();
    if (!clientId || !clientSecret || !redirectUri) return page("Muunganisho haujawekwa", "System Admin hajakamilisha mipangilio ya Google OAuth.", 503);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const tokens: any = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokens?.access_token || !tokens?.refresh_token) {
      return page("Idhini haikukamilika", "Google haikutoa token inayohitajika. Jaribu tena kwa link mpya ya mwaliko.", 502);
    }

    const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const channelBody: any = await channelResponse.json().catch(() => null);
    const channel = Array.isArray(channelBody?.items) ? channelBody.items[0] : null;
    const channelId = String(channel?.id || "");
    if (!channelResponse.ok || !channelId) {
      return page("Channel haikupatikana", "Google account hii haina YouTube channel inayoweza kuunganishwa.", 422);
    }
    if (channelId !== String(invite.channel_id || "")) {
      return page("Channel haitoshi na mwaliko", "Tumia Google account ya mmiliki wa channel iliyoandikwa kwenye mwaliko.", 403);
    }

    const saved = await completeYoutubeAnalyticsInvite({
      tokenHash: inviteHash,
      channelId,
      channelTitle: String(channel?.snippet?.title || invite.creator_name || "").slice(0, 160),
      refreshToken: String(tokens.refresh_token),
    });
    if (!saved) return page("Mwaliko umetumika", "Tengeneza link mpya kupitia System Admin wa Kristo App.", 410);
    return page("Channel imeunganishwa", "Asante. Taarifa za YouTube Analytics zitasomwa kwa channel hii tu. Unaweza kufunga ukurasa huu.");
  } catch {
    return page("Imeshindikana kuunganisha", "Jaribu tena baadaye au omba System Admin atengeneze link mpya.", 503);
  }
}
