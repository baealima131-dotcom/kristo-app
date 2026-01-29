import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { logAudit } from "@/app/api/_lib/audit";
import { rateLimit } from "@/app/api/_lib/rateLimit";

type ChurchMember = {
  id: string;
  churchId: string;
  userId: string;
  name: string;
  roleLabel?: string;
  joinedAt: string;
  updatedAt?: string;
};

type ApiErr = { ok: false; error: string; details?: unknown };
type ApiOk<T> = { ok: true; data: T };

const STORE_FILE = "members.json";

function json<T>(data: ApiOk<T> | ApiErr, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "cm") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "church_members_self", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } },
      { status: 429 }
    );
  }
  return null;
}

async function readAll(): Promise<ChurchMember[]> {
  const data = await readJsonFile<ChurchMember[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

/**
 * POST /api/church/members/self
 * - joins the current viewer into current church scope
 * - idempotent (returns existing if already a member)
 */
export async function POST(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  // ✅ allow any signed-in user; church scope must exist
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const viewerWithChurch: any = { ...viewer, churchId };

  if (!viewer?.userId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!churchId) return json({ ok: false, error: "Missing churchId scope" }, { status: 400 });

  const displayName = viewer.name?.trim() || "Member";

  // read existing membership
  const all = await readAll();
  const existing = all.find((m) => m.churchId === churchId && m.userId === viewer.userId);
  if (existing) {
    return json<ChurchMember>({ ok: true, data: existing });
  }

  const newMember: ChurchMember = {
    id: id(),
    churchId,
    userId: viewer.userId,
    name: displayName,
    roleLabel: viewer.role, // keep as label for now (we'll normalize later)
    joinedAt: nowIso(),
  };

  try {
    await updateJsonFile<ChurchMember[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const exists = list.some((m) => m.churchId === churchId && m.userId === viewer.userId);
        if (exists) return list; // idempotent safety
        list.unshift(newMember);
        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Write failed";
    return json({ ok: false, error: msg }, { status: 500 });
  }
  await logAudit({
    req,
    viewer: viewerWithChurch,
    churchId,
    action: "CHURCH_MEMBER_ADD",
    targetType: "church_member",
    targetId: newMember.id,
    message: `${viewer.name || viewer.userId} joined church as member.`,
    meta: { userId: newMember.userId, roleLabel: newMember.roleLabel },
  });

  return json<ChurchMember>({ ok: true, data: newMember }, { status: 201 });
}
