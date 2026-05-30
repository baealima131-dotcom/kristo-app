import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getChurchMediaRecord,
  isActiveChurchSubscription,
  upsertChurchMediaRecord,
} from "@/app/api/_lib/churchSubscription";
import { guard } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...((typeof data === "object" && data) || { data }) }, init);
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = String(ctxOrRes.churchId || "").trim();
  const media = await getChurchMediaRecord(churchId);

  return ok({
    media: media || {
      churchId,
      subscriptionActive: false,
      subscriptionStatus: "inactive",
    },
    profileMissing: !String(media?.mediaName || "").trim(),
    subscriptionActive: isActiveChurchSubscription(media),
  });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body", 400);
  }

  if (!body) return bad("Invalid JSON body", 400);

  const churchId = String(ctxOrRes.churchId || "").trim();
  const prev = await getChurchMediaRecord(churchId);

  const subscriptionActive =
    body.subscriptionActive !== undefined
      ? Boolean(body.subscriptionActive)
      : prev?.subscriptionActive;

  const subscriptionStatus =
    body.subscriptionStatus !== undefined
      ? String(body.subscriptionStatus || "").trim()
      : prev?.subscriptionStatus;

  const saved = await upsertChurchMediaRecord(churchId, {
    mediaName: String(body.mediaName || prev?.mediaName || "").trim() || undefined,
    category: String(body.category || prev?.category || "").trim() || undefined,
    subCategory: String(body.subCategory || prev?.subCategory || "").trim() || undefined,
    targetAudience: String(body.targetAudience || prev?.targetAudience || "").trim() || undefined,
    language: String(body.language || prev?.language || "").trim() || undefined,
    country: String(body.country || prev?.country || "").trim() || undefined,
    contentStyle: String(body.contentStyle || prev?.contentStyle || "").trim() || undefined,
    bio: String(body.bio || prev?.bio || "").trim() || undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : prev?.tags,
    hosts: Array.isArray(body.hosts) ? body.hosts : prev?.hosts,
    subscriptionActive,
    subscriptionStatus: subscriptionActive ? "active" : subscriptionStatus || "inactive",
    subscriptionActivatedAt:
      subscriptionActive && !prev?.subscriptionActive
        ? new Date().toISOString()
        : prev?.subscriptionActivatedAt,
  });

  return ok({ media: saved, subscriptionActive: isActiveChurchSubscription(saved) });
}
