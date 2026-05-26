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

  // 2) store helper fallback (if your store/fs is wired)
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

type Membership = {
  id?: string;
  userId?: string;
  churchId?: string;
  status?: string;
  isActive?: boolean;
  active?: boolean;
  createdAt?: any;
};

type MinistryMember = {
  id?: string;
  userId?: string;
  churchId?: string;
  ministryId?: string;
  status?: string;
  isActive?: boolean;
  active?: boolean;
  createdAt?: any;
};

function isTruthyActive(x: any) {
  if (!x) return false;
  if (x.isActive === true || x.active === true) return true;
  const s = String(x.status || "").toLowerCase();
  return s === "active" || s === "approved";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const targetUserId = safeString((params as any)?.userId).trim();
  if (!targetUserId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

  // viewer info (role is useful for badges)
  const viewer = ctxOrRes.viewer;

  // Best-effort reads (won't crash if files differ)
  const memberships = await tryReadDevJson<any>(
    ["memberships.json", "membership.json", "church-memberships.json"],
    []
  );

  const ministryMembers = await tryReadDevJson<any>(
    ["ministry-members.json", "ministryMembers.json", "ministry_members.json"],
    []
  );

  const follows = await tryReadDevJson<any>(
    ["follows.json", "followers.json", "social.json"],
    { followers: [], following: [] }
  );

  const posts = await tryReadDevJson<any>(
    ["posts.json", "user-posts.json"],
    []
  );

  const memArr: Membership[] = Array.isArray(memberships) ? memberships : Object.values(memberships || {});
  const mmArr: MinistryMember[] = Array.isArray(ministryMembers) ? ministryMembers : Object.values(ministryMembers || {});

  const activeMembership = memArr.find((m) => m && m.userId === targetUserId && isTruthyActive(m));
  const activeChurchId = safeString(activeMembership?.churchId).trim();

  const ministryIds = Array.from(
    new Set(
      mmArr
        .filter((m) => m && m.userId === targetUserId && isTruthyActive(m))
        .map((m) => safeString(m.ministryId).trim())
        .filter(Boolean)
    )
  );

  // Counts (fallback to 0 if unknown)
  let followersCount = 0;
  let followingCount = 0;
  let viewerFollowsTarget = false;

  // If follows is an object with arrays
  if (follows && typeof follows === "object" && !Array.isArray(follows)) {
    const followers = Array.isArray((follows as any).followers) ? (follows as any).followers : [];
    const following = Array.isArray((follows as any).following) ? (follows as any).following : [];
    followersCount = followers.filter((x: any) => x && (x.toUserId === targetUserId || x.followingId === targetUserId)).length;
    followingCount = following.filter((x: any) => x && (x.fromUserId === targetUserId || x.followerId === targetUserId)).length;
  } else if (Array.isArray(follows)) {
    // If follows is an array of edges: {fromUserId,toUserId}
    followersCount = (follows as any[]).filter((x) => x && x.toUserId === targetUserId).length;
    followingCount = (follows as any[]).filter((x) => x && x.fromUserId === targetUserId).length;
  }

  const viewerUserId = safeString(viewer?.userId).trim();
  if (viewerUserId) {
    if (follows && typeof follows === "object" && !Array.isArray(follows)) {
      const followers = Array.isArray((follows as any).followers) ? (follows as any).followers : [];
      const following = Array.isArray((follows as any).following) ? (follows as any).following : [];
      const merged = [...followers, ...following];
      viewerFollowsTarget = merged.some(
        (x: any) =>
          x &&
          (String(x?.fromUserId || x?.followerId || "").trim() === viewerUserId) &&
          (String(x?.toUserId || x?.followingId || "").trim() === targetUserId)
      );
    } else if (Array.isArray(follows)) {
      viewerFollowsTarget = (follows as any[]).some(
        (x: any) =>
          x &&
          String(x?.fromUserId || "").trim() === viewerUserId &&
          String(x?.toUserId || "").trim() === targetUserId
      );
    }
  }

  const postsArr = Array.isArray(posts) ? posts : Object.values(posts || {});
  const postsCount = postsArr.filter((x: any) => x && (x.userId === targetUserId || x.authorId === targetUserId)).length;

  return json({
    ok: true,
    data: {
      userId: targetUserId,
      viewerRole: viewer.role,
      viewerChurchId: "",
      followersCount,
      followingCount,
      viewerFollowsTarget,
      postsCount,
      activeChurchId,
      ministryIds,
    },
  });
}
