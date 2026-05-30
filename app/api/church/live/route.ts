import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  requireChurchSubscription,
  requiresScheduleSubscription,
} from "@/app/api/_lib/churchSubscription";
import { guard } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

type LiveState = {
  churchId: string;
  liveId: string;
  isLive: boolean;
  title?: string;
  mediaName?: string;
  scheduleType?: string;
  scheduleSlots?: unknown[];
  createdAt: string;
  updatedAt?: string;
};

declare global {
  var __kristoChurchLive: Record<string, LiveState> | undefined;
}

function liveStore() {
  if (!globalThis.__kristoChurchLive) globalThis.__kristoChurchLive = {};
  return globalThis.__kristoChurchLive;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = String(ctxOrRes.churchId || "").trim();
  const live = liveStore()[churchId] || null;

  return NextResponse.json({
    ok: true,
    live: live && live.isLive ? live : null,
  });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body", 400);
  }

  if (!body) return bad("Invalid JSON body", 400);

  const churchId = String(ctxOrRes.churchId || "").trim();
  const action = String(body.action || "create_live_schedule").trim().toLowerCase();

  if (requiresScheduleSubscription(body) || action.includes("schedule") || action.includes("create")) {
    const blocked = await requireChurchSubscription(churchId);
    if (blocked) return blocked;
  }

  const now = new Date().toISOString();
  const liveId = String(body.liveId || `live_${Date.now()}`).trim();
  const next: LiveState = {
    churchId,
    liveId,
    isLive: action === "start" || action === "go_live" ? true : false,
    title: String(body.title || body.text || "Church Live").trim(),
    mediaName: String(body.mediaName || "Church Media").trim(),
    scheduleType: String(body.scheduleType || "media-live-slots").trim(),
    scheduleSlots: Array.isArray(body.scheduleSlots) ? body.scheduleSlots : [],
    createdAt: now,
    updatedAt: now,
  };

  liveStore()[churchId] = next;

  return NextResponse.json({ ok: true, live: next }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body", 400);
  }

  if (!body) return bad("Invalid JSON body", 400);

  const churchId = String(ctxOrRes.churchId || "").trim();
  const action = String(body.action || "").trim().toLowerCase();

  if (requiresScheduleSubscription(body) || action.includes("schedule")) {
    const blocked = await requireChurchSubscription(churchId);
    if (blocked) return blocked;
  }

  const prev = liveStore()[churchId];
  if (!prev) return bad("Live session not found", 404);

  const next: LiveState = {
    ...prev,
    ...body,
    churchId,
    updatedAt: new Date().toISOString(),
  };

  liveStore()[churchId] = next;

  return NextResponse.json({ ok: true, live: next });
}
