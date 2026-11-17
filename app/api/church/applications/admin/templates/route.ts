import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import {
  deleteRequirementTemplate,
  listRequirementTemplates,
  saveRequirementTemplate,
} from "@/app/api/_lib/churchApplications";
import { caError, caJson } from "@/app/api/_lib/churchApplicationsHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** System Admin: reusable church requirement templates (built-in + custom). */
export async function GET(req: NextRequest) {
  const ctx = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return caJson({ ok: true, templates: await listRequirementTemplates() });
  } catch (error) {
    return caError(error, "applications.templates.GET");
  }
}

export async function POST(req: NextRequest) {
  const ctx = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    return caJson({ ok: true, template: await saveRequirementTemplate(ctx.viewer.userId, body) }, 201);
  } catch (error) {
    return caError(error, "applications.templates.POST");
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  const id = String(new URL(req.url).searchParams.get("id") || "");
  try {
    await deleteRequirementTemplate(ctx.viewer.userId, id);
    return caJson({ ok: true });
  } catch (error) {
    return caError(error, "applications.templates.DELETE");
  }
}
