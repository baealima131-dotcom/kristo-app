import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/app/api/_lib/rbac";
import {
  readCoreJsonFile as readJsonFile,
  updateCoreJsonFile as updateJsonFile,
} from "@/app/api/_lib/store/coreDb";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

type FollowEdge = {
  id: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
};

function normalizeFollowsShape(raw: any): FollowEdge[] {
  if (Array.isArray(raw)) return raw as FollowEdge[];

  if (raw && typeof raw === "object") {
    const followers = Array.isArray(raw.followers) ? raw.followers : [];
    const following = Array.isArray(raw.following) ? raw.following : [];
    const merged = [...followers, ...following]
      .map((x: any) => ({
        id: String(x?.id || "").trim(),
        fromUserId: String(x?.fromUserId || x?.followerId || "").trim(),
        toUserId: String(x?.toUserId || x?.followingId || "").trim(),
        createdAt: String(x?.createdAt || "").trim(),
      }))
      .filter((x: FollowEdge) => x.fromUserId && x.toUserId);

    const seen = new Set<string>();
    return merged.filter((x) => {
      const k = `${x.fromUserId}__${x.toUserId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return [];
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const viewerUserId = safeString(ctxOrRes.viewer?.userId);
  const targetUserId = safeString((params as any)?.userId);

  if (!viewerUserId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!targetUserId) return json({ ok: false, error: "Missing userId" }, { status: 400 });
  if (viewerUserId === targetUserId) {
    return json({ ok: false, error: "You cannot follow yourself." }, { status: 400 });
  }

  const next = await updateJsonFile<any>(
    "follows.json",
    (current) => {
      const edges = normalizeFollowsShape(current);
      const exists = edges.some((x) => x.fromUserId === viewerUserId && x.toUserId === targetUserId);
      if (exists) return edges;

      return [
        {
          id: `follow_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
          fromUserId: viewerUserId,
          toUserId: targetUserId,
          createdAt: new Date().toISOString(),
        },
        ...edges,
      ];
    },
    []
  );

  const edges = normalizeFollowsShape(next);
  return json({
    ok: true,
    data: {
      following: true,
      followersCount: edges.filter((x) => x.toUserId === targetUserId).length,
      followingCount: edges.filter((x) => x.fromUserId === targetUserId).length,
      viewerFollowingCount: edges.filter((x) => x.fromUserId === viewerUserId).length,
    },
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const viewerUserId = safeString(ctxOrRes.viewer?.userId);
  const targetUserId = safeString((params as any)?.userId);

  if (!viewerUserId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!targetUserId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

  const next = await updateJsonFile<any>(
    "follows.json",
    (current) => {
      const edges = normalizeFollowsShape(current);
      return edges.filter((x) => !(x.fromUserId === viewerUserId && x.toUserId === targetUserId));
    },
    []
  );

  const edges = normalizeFollowsShape(next);
  return json({
    ok: true,
    data: {
      following: false,
      followersCount: edges.filter((x) => x.toUserId === targetUserId).length,
      followingCount: edges.filter((x) => x.fromUserId === targetUserId).length,
      viewerFollowingCount: edges.filter((x) => x.fromUserId === viewerUserId).length,
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const viewerUserId = safeString(ctxOrRes.viewer?.userId);
  const targetUserId = safeString((params as any)?.userId);

  if (!targetUserId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

  const raw = await readJsonFile<any>("follows.json", []);
  const edges = normalizeFollowsShape(raw);

  return json({
    ok: true,
    data: {
      following: !!viewerUserId && edges.some((x) => x.fromUserId === viewerUserId && x.toUserId === targetUserId),
      followersCount: edges.filter((x) => x.toUserId === targetUserId).length,
      followingCount: edges.filter((x) => x.fromUserId === targetUserId).length,
    },
  });
}
