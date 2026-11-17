import { NextResponse } from "next/server";

export const APP_UPDATE_REQUIRED_MESSAGE = "Please update Kristo App to the latest version.";

/**
 * Store builds up to iOS 1.0.3 / Android 1.0.2 call My Way and Church Ministries with
 * x-kristo-user-id but no session token. Such a request stays refused (401, no data); only
 * the error text changes, so those apps show a plain "please update" instead of "Unauthorized".
 */
function isOldAppHeaderOnlyRequest(req: Request): boolean {
  return (
    Boolean(String(req.headers.get("x-kristo-user-id") || "").trim()) &&
    !String(req.headers.get("x-kristo-session-token") || "").trim() &&
    !String(req.headers.get("authorization") || "").trim()
  );
}

/** Replaces a 401 for an old app's header-only request with the update message; anything else is returned unchanged. */
export function withAppUpdateRequired(res: NextResponse, req: Request): NextResponse {
  if (res.status !== 401 || !isOldAppHeaderOnlyRequest(req)) return res;
  return NextResponse.json(
    {
      ok: false,
      error: APP_UPDATE_REQUIRED_MESSAGE,
      message: APP_UPDATE_REQUIRED_MESSAGE,
      code: "app_update_required",
      updateRequired: true,
    },
    { status: 401 }
  );
}
