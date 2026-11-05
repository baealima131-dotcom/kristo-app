import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import {
  CHURCH_APPLICATION_STATUS_LABELS,
  listChurchApplicationsForAdmin,
  toAdminView,
} from "@/app/api/_lib/churchApplications";
import { caError, caJson } from "@/app/api/_lib/churchApplicationsHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** System Admin: all church applications. ?status=&source=direct|agent&q= */
export async function GET(req: NextRequest) {
  const ctx = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  const sp = new URL(req.url).searchParams;
  try {
    const result = await listChurchApplicationsForAdmin({
      status: sp.get("status") || undefined,
      source: sp.get("source") || undefined,
      q: sp.get("q") || undefined,
    });
    return caJson({
      ok: true,
      applications: result.applications.map(toAdminView),
      counts: result.counts,
      sourceCounts: result.sourceCounts,
      statusLabels: CHURCH_APPLICATION_STATUS_LABELS,
    });
  } catch (error) {
    return caError(error, "applications.admin.GET");
  }
}
