import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth, guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { submitChurchApplication, toApplicantView } from "@/app/api/_lib/churchApplications";
import { caError, caJson } from "@/app/api/_lib/churchApplicationsHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit a church application. Never creates or opens a church: a System Admin reviews it.
 * source "agent": only a platform Agent, on behalf of a leader (Kristo ID), with an activation
 * code assigned to that agent. Otherwise the signed-in user applies for their own church.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const source = body?.source === "agent" ? "agent" : "direct";

  let actorUserId = "";
  if (source === "agent") {
    const ctx = await guardPlatformOfflineActivation(req, ["Agent"]);
    if (ctx instanceof NextResponse) return ctx;
    actorUserId = ctx.viewer.userId;
  } else {
    const auth = await guardAuth(req);
    if (auth instanceof NextResponse) return auth;
    actorUserId = auth.viewer.userId;
  }

  // Per account (agents often share one network).
  const rl = await rateLimit(req, {
    name: "church_applications_submit",
    limit: 10,
    windowMs: 60_000,
    key: `church_applications_submit:${actorUserId}`,
  });
  if (!rl.allowed) return caJson({ ok: false, error: "rate_limited", message: "Too many requests. Try again in a minute." }, 429);

  try {
    const app = await submitChurchApplication({ actorUserId, source, body });
    // The agent gets the confirmation; the applicant's full view is theirs alone.
    return caJson(
      source === "agent"
        ? { ok: true, application: { id: app.id, status: app.status, churchName: app.church.name, submittedAt: app.submittedAt } }
        : { ok: true, application: toApplicantView(app) },
      201
    );
  } catch (error) {
    return caError(error, "applications.POST");
  }
}
