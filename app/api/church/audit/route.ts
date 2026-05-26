// app/api/church/audit/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { logAudit, readAudit } from "@/app/api/_lib/audit";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * GET /api/church/audit?limit=200&action=...&q=...
 * - church scoped
 * - roles: Pastor, Church_Admin, Leader
 */
export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId } = ctxOrRes;

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;

  const action = String(url.searchParams.get("action") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  const all = await readAudit(churchId);

  let data = all;

  if (action) data = data.filter((x) => x.action === action);

  if (q) {
    data = data.filter((x) => {
      const a = (x.message || "").toLowerCase();
      const b = (x.actorName || "").toLowerCase();
      const c = (x.actorUserId || "").toLowerCase();
      const d = (x.targetId || "").toLowerCase();
      const e = (x.targetType || "").toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q) || d.includes(q) || e.includes(q);
    });
  }

  return json({ ok: true, data: data.slice(0, limit) });
}

/**
 * POST /api/church/audit
 * - church scoped
 * - roles: Pastor, Church_Admin, Leader
 */
export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  try {
    const body = await req.json().catch(() => ({}));

    const action = String(body?.action || "").trim();
    const targetId =
      body?.targetId == null || body?.targetId === ""
        ? undefined
        : String(body.targetId);
    const targetType =
      body?.targetType == null || body?.targetType === ""
        ? undefined
        : String(body.targetType);
    const message =
      body?.message == null || body?.message === ""
        ? undefined
        : String(body.message);
    const meta =
      body?.meta && typeof body.meta === "object" ? body.meta : undefined;

    if (!action) {
      return json({ ok: false, error: "action is required" }, { status: 400 });
    }

    await logAudit({
      req,
      viewer: { ...viewer, churchId },
      churchId,
      action: action as any,
      targetId,
      targetType,
      message,
      meta,
    });

    const latest = await readAudit(churchId);
    return json({ ok: true, data: latest[0] || null });
  } catch (e: any) {
    return json(
      { ok: false, error: String(e?.message || "Failed to write audit log") },
      { status: 500 }
    );
  }
}
