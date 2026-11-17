import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import {
  getMyChurchApplication,
  getPendingChurchForMember,
  markMyApplicationSeen,
  respondToInfoRequest,
  toApplicantView,
} from "@/app/api/_lib/churchApplications";
import { caError, caJson } from "@/app/api/_lib/churchApplicationsHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user's own church application (never anyone else's), and — for a member of a
 * church that is not open yet — that church's activation progress. ?seen=1 clears the
 * "new update" flag.
 */
export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.viewer.userId;
  try {
    const app = await getMyChurchApplication(userId);
    if (app && new URL(req.url).searchParams.get("seen") === "1" && app.applicantUnseenUpdate) {
      await markMyApplicationSeen(userId, app.id);
      app.applicantUnseenUpdate = false;
    }
    const pendingChurch = app?.churchId ? null : await getPendingChurchForMember(userId);
    return caJson({ ok: true, application: app ? toApplicantView(app) : null, pendingChurch });
  } catch (error) {
    return caError(error, "applications.mine.GET");
  }
}

/** Answer a "More Information Needed" request (optionally correcting church details). */
export async function PATCH(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  try {
    const saved = await respondToInfoRequest(auth.viewer.userId, String(body?.applicationId || ""), body);
    return caJson({ ok: true, application: toApplicantView(saved) });
  } catch (error) {
    return caError(error, "applications.mine.PATCH");
  }
}
