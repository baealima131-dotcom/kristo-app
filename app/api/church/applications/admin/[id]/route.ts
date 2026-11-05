import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { applyAdminAction, getChurchApplicationForAdmin, toAdminView } from "@/app/api/_lib/churchApplications";
import { caError, caJson } from "@/app/api/_lib/churchApplicationsHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const ctx = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await context.params;
  try {
    return caJson({ ok: true, application: toAdminView(await getChurchApplicationForAdmin(String(id || ""))) });
  } catch (error) {
    return caError(error, "applications.admin.id.GET");
  }
}

/**
 * System Admin decision: note | request_info | reject | approve | update_requirements |
 * extend_deadline | complete_requirement | activate.
 */
export async function POST(req: NextRequest, context: Ctx) {
  const ctx = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  try {
    const saved = await applyAdminAction({ adminUserId: ctx.viewer.userId, id: String(id || ""), body });
    return caJson({ ok: true, application: toAdminView(saved) });
  } catch (error) {
    return caError(error, "applications.admin.id.POST");
  }
}
