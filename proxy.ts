import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const IOS_BUNDLE_ID = String(process.env.IOS_BUNDLE_ID || "com.princefariji.kristoapp").trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || "").trim();

function buildAasaBody() {
  const appId = APPLE_TEAM_ID ? `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}` : `TEAMID.${IOS_BUNDLE_ID}`;

  return {
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
}

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/.well-known/apple-app-site-association") {
    return NextResponse.json(buildAasaBody(), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
        ...(APPLE_TEAM_ID ? {} : { "X-Kristo-AASA-Warning": "Set APPLE_TEAM_ID on Vercel for Universal Links" }),
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
