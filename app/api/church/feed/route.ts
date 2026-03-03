import { NextResponse } from "next/server";
import { requireAuth, requireChurchScope } from "@/app/api/_lib/rbac";
import { NextResponse } from "next/server";
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
  createdBy: string; // userId
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };

function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data } satisfies ApiOk<T>, init);
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

export async function GET(req: Request) {
  const viewer = requireAuth(req);
  const { churchId } = requireChurchScope(req, viewer);

  const url = new URL(req.url);
  const type = url.searchParams.get("type") as FeedType | null;

  const items = store()
    .filter((x) => x.churchId === churchId)
    .filter((x) => (type ? x.type === type : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return ok(items);
}

export async function POST(req: Request) {
  const viewer = requireAuth(req);
  const { churchId } = requireChurchScope(req, viewer);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const type = body?.type as FeedType | undefined;
  if (!type || !["post", "announcement", "video"].includes(type)) {
    return err('type is required: "post" | "announcement" | "video"', 400);
  }

  const title = typeof body?.title === "string" ? body.title.trim() : undefined;
  const text = typeof body?.text === "string" ? body.text.trim() : undefined;
  const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl.trim() : undefined;

  if (type === "video" && !videoUrl) return err("videoUrl is required for type=video", 400);
  if ((type === "post" || type === "announcement") && !text) return err("text is required", 400);

  const item: ChurchFeedItem = {
    id: makeId("feed"),
    churchId,
    type,
    title,
    text,
    videoUrl,
    createdAt: new Date().toISOString(),
    createdBy: viewer.userId,
  };

  store().push(item);
  return ok(item, { status: 201 });
}
