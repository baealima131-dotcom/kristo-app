import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/app/api/_lib/auth";

export const runtime = "nodejs";

type Announcement = {
  id: string;
  churchId: string;
  title: string;
  body?: string;
  createdAt: string;
  createdBy: string;
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

function store(): Announcement[] {
  const g = globalThis as any;
  if (!g.__kristo_church_announcements) g.__kristo_church_announcements = [];
  return g.__kristo_church_announcements as Announcement[];
}

function canPost(role: string) {
  return role === "Church_Admin" || role === "Pastor" || role === "System_Admin";
}

export async function GET(req: NextRequest) {
  const v = await getViewer(req);
  if (!v?.churchId) return json<Err>({ ok: false, error: "No church scope" }, 401);

  const items = store()
    .filter((a) => a.churchId === v.churchId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return json<Ok<Announcement[]>>({ ok: true, data: items });
}

export async function POST(req: NextRequest) {
  const v = await getViewer(req);
  if (!v?.churchId) return json<Err>({ ok: false, error: "No church scope" }, 401);
  if (!canPost(v.role)) return json<Err>({ ok: false, error: "Forbidden" }, 403);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json<Err>({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const title = String(body?.title || "").trim();
  const text = String(body?.body || "").trim();

  if (!title) return json<Err>({ ok: false, error: "title is required" }, 400);

  const a: Announcement = {
    id: `ann_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    churchId: v.churchId,
    title,
    body: text || undefined,
    createdAt: new Date().toISOString(),
    createdBy: v.userId,
  };

  store().push(a);
  return json<Ok<Announcement>>({ ok: true, data: a }, 201);
}
