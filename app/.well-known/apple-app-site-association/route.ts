import { NextResponse } from "next/server";

export const runtime = "nodejs";

const IOS_BUNDLE_ID = String(process.env.IOS_BUNDLE_ID || "com.princefariji.kristoapp").trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || "").trim();
const SHARE_HOST = "kristo-app.vercel.app";

export async function GET() {
  const appId = APPLE_TEAM_ID ? `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}` : `TEAMID.${IOS_BUNDLE_ID}`;

  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          paths: ["/post/*", "/post/*?*"],
        },
      ],
    },
    webcredentials: {
      apps: APPLE_TEAM_ID ? [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`] : [],
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "X-Kristo-AASA-Host": SHARE_HOST,
      ...(APPLE_TEAM_ID ? {} : { "X-Kristo-AASA-Warning": "Set APPLE_TEAM_ID on Vercel for Universal Links" }),
    },
  });
}
