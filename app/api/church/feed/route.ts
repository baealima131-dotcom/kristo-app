import { NextRequest, NextResponse } from "next/server";

import {
  requireChurchSubscription,
  requiresScheduleSubscription,
} from "@/app/api/_lib/churchSubscription";
import { guard } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

type FeedType = "post" | "announcement" | "video";

export type ChurchFeedItem = {
  id: string;
  churchId: string;
  type: FeedType;
  title?: string;
  text?: string;
  videoUrl?: string;
  createdAt: string;
  createdBy: string;
  [key: string]: unknown;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };

function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data, item: data } satisfies ApiOk<T> & { item: T }, init);
}

function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error } satisfies ApiErr, { status });
}

declare global {
  var __kristoChurchFeed: ChurchFeedItem[] | undefined;
}

function store(): ChurchFeedItem[] {
  if (!globalThis.__kristoChurchFeed) globalThis.__kristoChurchFeed = [];
  return globalThis.__kristoChurchFeed;
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function parseBody(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if ("ok" in (ctxOrRes as any) === false && ctxOrRes instanceof NextResponse) return ctxOrRes;
  const ctx = ctxOrRes as any;
  const churchId = String(ctx.churchId);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") as FeedType | null;
  const items = store()
    .filter((x) => x.churchId === churchId)
    .filter((x) => (type ? x.type === type : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return ok(items);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if ("ok" in (ctxOrRes as any) === false && ctxOrRes instanceof NextResponse) return ctxOrRes;
  const ctx = ctxOrRes as any;
  const churchId = String(ctx.churchId);

  const body = await parseBody(req);
  if (!body) return err("Invalid JSON body", 400);

  const action = String(body?.action || "").trim().toLowerCase();

  if (requiresScheduleSubscription(body)) {
    const blocked = await requireChurchSubscription(churchId);
    if (blocked) return blocked;
  }

  if (action === "clear_media_schedules") {
    const before = store().length;
    globalThis.__kristoChurchFeed = store().filter(
      (item) =>
        !(
          item.churchId === churchId &&
          (String(item.source || "").includes("media-schedule") ||
            String(item.scheduleType || "").includes("live-slots"))
        )
    );
    return ok({ removed: before - store().length });
  }

  if (action === "update-schedule-slots") {
    const postId = String(body?.postId || body?.id || "").trim();
    if (!postId) return err("postId is required", 400);

    const slots = Array.isArray(body?.scheduleSlots) ? body.scheduleSlots : null;
    if (!slots) return err("scheduleSlots is required", 400);

    let updated: ChurchFeedItem | null = null;
    globalThis.__kristoChurchFeed = store().map((item) => {
      if (item.id !== postId || item.churchId !== churchId) return item;
      updated = { ...item, scheduleSlots: slots, updatedAt: new Date().toISOString() };
      return updated;
    });

    if (!updated) return err("Feed item not found", 404);
    return ok(updated);
  }

  const type = body?.type as FeedType | undefined;
  if (!type || !["post", "announcement", "video"].includes(type)) {
    return err('type is required: "post" | "announcement" | "video"', 400);
  }

  const title = typeof body?.title === "string" ? body.title.trim() : undefined;
  const text =
    typeof body?.text === "string"
      ? body.text.trim()
      : typeof body?.caption === "string"
        ? body.caption.trim()
        : undefined;
  const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl.trim() : undefined;

  if (type === "video" && !videoUrl) return err("videoUrl is required for type=video", 400);
  if ((type === "post" || type === "announcement") && !text && !title) {
    return err("text or title is required", 400);
  }

  const item: ChurchFeedItem = {
    id: makeId("feed"),
    churchId,
    type,
    title,
    text,
    videoUrl,
    createdAt: new Date().toISOString(),
    createdBy: String(ctx?.viewer?.userId || ctx?.viewer?.id || "u-unknown"),
    ...body,
    churchId,
    type,
    title,
    text,
    videoUrl,
  };

  store().push(item);
  return ok(item, { status: 201 });
}
