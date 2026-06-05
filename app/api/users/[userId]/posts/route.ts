import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import fs from "node:fs/promises";
import path from "node:path";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile } from "@/app/api/_lib/store/fs";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

async function tryReadDevJson<T>(names: string[], fallback: T): Promise<T> {
  // 1) .kristo-dev first
  for (const n of names) {
    try {
      const fp = path.join(process.cwd(), ".kristo-dev", n);
      const raw = await fs.readFile(fp, "utf8");
      return (JSON.parse(raw) as T) ?? fallback;
    } catch {
      // ignore
    }
  }

  // 2) store helper fallback
  for (const n of names) {
    try {
      const data = await readJsonFile<T>(n, fallback as any);
      return (data as T) ?? fallback;
    } catch {
      // ignore
    }
  }

  return fallback;
}

type Post = {
  id?: string;
  userId?: string;
  authorId?: string;

  type?: string; // "video" | "image" | "text"
  caption?: string;

  videoUrl?: string;
  imageUrl?: string;

  createdAt?: any;

  // counters (optional in store)
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  repostsCount?: number;
};

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;

  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const targetUserId = safeString((params as any)?.userId).trim();
  if (!targetUserId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(60, asNum(url.searchParams.get("limit"), 18)));

  // Read-only legacy/dev fallback: posts.json / user-posts.json have no writer
  // in the codebase (real posts come from the feed system), so this never
  // persists to /tmp in production. Returns empty when absent. Safe to leave.
  const rawPosts = await tryReadDevJson<any>(["posts.json", "user-posts.json"], []);

  const arr: Post[] = Array.isArray(rawPosts) ? rawPosts : Object.values(rawPosts || {});
  const mine = arr
    .filter((p) => p && (p.userId === targetUserId || p.authorId === targetUserId))
    .sort((a, b) => asNum(b.createdAt, 0) - asNum(a.createdAt, 0))
    .slice(0, limit)
    .map((p) => ({
      id: safeString(p.id) || `post_${Math.random().toString(16).slice(2)}`,
      userId: safeString(p.userId || p.authorId || targetUserId),
      type: safeString(p.type || (p.videoUrl ? "video" : p.imageUrl ? "image" : "text")) || "text",
      caption: safeString(p.caption),
      videoUrl: safeString(p.videoUrl),
      imageUrl: safeString(p.imageUrl),
      createdAt: p.createdAt ?? Date.now(),
      likesCount: asNum(p.likesCount, 0),
      commentsCount: asNum(p.commentsCount, 0),
      sharesCount: asNum(p.sharesCount, 0),
      repostsCount: asNum(p.repostsCount, 0),
    }));

  return json({ ok: true, data: { userId: targetUserId, items: mine } });
}
