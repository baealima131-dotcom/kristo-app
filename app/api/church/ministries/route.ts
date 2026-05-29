import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { logAudit } from "@/app/api/_lib/audit";
import { rateLimit } from "@/app/api/_lib/rateLimit";

/* =========================
   TYPES
   ========================= */

type MinistryStatus = "Active" | "Paused";

type Ministry = {
  id: string;
  name: string;
  description?: string;
  avatarUri?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
  createdByUserId?: string;
  mediaAccess?: boolean;
};

type ApiErr = { ok: false; error: string; details?: unknown };
type ApiOk<T> = { ok: true; data: T };

const STORE_FILE = "ministries.json";

// VIP constraints (keeps data clean)
const NAME_MAX = 80;
const DESC_MAX = 700;

/* =========================
   HELPERS
   ========================= */

function json<T>(data: ApiOk<T> | ApiErr, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function nowIso() {
  return new Date().toISOString();
}

function isStatus(x: string): x is MinistryStatus {
  return x === "Active" || x === "Paused";
}

function parseStatus(input: unknown, fallback: MinistryStatus): MinistryStatus | null {
  if (input === undefined || input === null) return fallback;
  const s = String(input).trim();
  return isStatus(s) ? s : null;
}

function parseDescription(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  return s.length > DESC_MAX ? s.slice(0, DESC_MAX) : s;
}


function parseAvatarUri(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;

  const s = String(input).trim();
  if (!s) return undefined;

  const ok =
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("file://") ||
    s.startsWith("content://") ||
    s.startsWith("/");

  if (!ok) return undefined;

  return s.length > 1200 ? s.slice(0, 1200) : s;
}

function sanitizeName(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX) : s;
}

function id(prefix = "min") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function readAll(): Promise<Ministry[]> {
  const data = await readJsonFile<Ministry[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "ministries", limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } } satisfies ApiErr,
      { status: 429 }
    );
  }
  return null;
}

function asBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return req.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/* =========================
   GET /api/church/ministries
   ========================= */

export async function GET(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId } = ctxOrRes;
  const url = new URL(req.url);
  const idParam = String(url.searchParams.get("id") || "").trim();

  const all = await readAll();

  if (idParam) {
    const one = all.find((m) => m.id === idParam && m.churchId === churchId);
    if (!one) {
      return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });
    }
    return json<Ministry>({ ok: true, data: one });
  }

  const data = all.filter((m) => m.churchId === churchId);

  return json<Ministry[]>({ ok: true, data });
}

/* =========================
   POST /api/church/ministries
   body: { name, description?, status? }
   ========================= */

export async function POST(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Ministry_Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  const name = sanitizeName(body.name);
  if (!name) return json({ ok: false, error: "Ministry name is required" } satisfies ApiErr, { status: 400 });

  const status = parseStatus(body.status, "Active");
  if (!status) return json({ ok: false, error: "Invalid status" } satisfies ApiErr, { status: 400 });

  const description = parseDescription(body.description);
  const avatarUri = parseAvatarUri(body.avatarUri);
  const mediaAccess = body.mediaAccess === true;

  const created: Ministry = {
    id: id(),
    name,
    description,
    avatarUri,
    mediaAccess,
    status,
    churchId,
    createdByUserId: viewer.userId,
    createdAt: nowIso(),
  };

  try {
    await updateJsonFile<Ministry[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        list.unshift(created);
        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Write failed";
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  // Pastor/creator is always member #1 and senior leader of every ministry.
  try {
    await updateJsonFile<any[]>(
      "ministry-members.json",
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const userId = String(viewer.userId || "").trim();

        if (!userId) return list;

        const exists = list.some(
          (mm: any) =>
            String(mm?.churchId || "") === String(churchId) &&
            String(mm?.ministryId || "") === String(created.id) &&
            String(mm?.userId || "") === userId
        );

        if (exists) return list;

        list.unshift({
          id: `mm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          churchId,
          ministryId: created.id,
          userId,
          role: "Leader",
          createdAt: nowIso(),
        });

        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to assign pastor as ministry leader";
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  await logAudit({
    req,
    viewer,
    churchId,
    action: "MINISTRY_CREATE",
    targetType: "ministry",
    targetId: created.id,
    message: `${viewer.name || viewer.userId} created ministry ${name}.`,
    meta: { name, status, description, avatarUri },
  } as any);

  return json<Ministry>({ ok: true, data: created }, { status: 201 });
}

/* =========================
   PATCH /api/church/ministries?id=...
   body: { name?, description?, status? }
   ========================= */

export async function PATCH(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const url = new URL(req.url);
  const mid = String(url.searchParams.get("id") || "").trim();
  if (!mid) return json({ ok: false, error: "Missing id" } satisfies ApiErr, { status: 400 });

  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  let updated: Ministry | null = null;
  let notFound = false;

  // for VIP audit (detect status toggle vs general update)
  let prevStatus: MinistryStatus | null = null;
  let nextStatusForAudit: MinistryStatus | null = null;

  try {
    await updateJsonFile<Ministry[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const idx = list.findIndex((m) => m.id === mid && m.churchId === churchId);

        if (idx < 0) {
          notFound = true;
          return list;
        }

        const cur = list[idx];

        const nextName =
          body.name !== undefined ? sanitizeName(body.name) : cur.name;

        if (!nextName) throw new Error("Ministry name is required");

        const nextStatus = parseStatus(body.status, cur.status);
        if (!nextStatus) throw new Error("Invalid status");

        const nextDescription =
          body.description !== undefined ? parseDescription(body.description) : cur.description;

        const nextMediaAccess =
          body.mediaAccess !== undefined ? body.mediaAccess === true : !!(cur as any).mediaAccess;

        const nextAvatarUri =
          body.avatarUri !== undefined ? parseAvatarUri(body.avatarUri) : cur.avatarUri;

        prevStatus = cur.status;
        nextStatusForAudit = nextStatus;

        updated = {
          ...cur,
          name: nextName,
          status: nextStatus,
          description: nextDescription,
          avatarUri: nextAvatarUri,
          mediaAccess: nextMediaAccess,
          updatedAt: nowIso(),
        };

        list[idx] = updated;
        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Update failed";
    if (msg === "Ministry name is required" || msg === "Invalid status") {
      return json({ ok: false, error: msg } satisfies ApiErr, { status: 400 });
    }
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  if (notFound || !updated) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  const u = updated as any as Ministry;

  const statusToggled = !!(prevStatus && nextStatusForAudit && prevStatus !== nextStatusForAudit);

  await logAudit({
    req,
    viewer,
    churchId,
    action: statusToggled ? "MINISTRY_STATUS_TOGGLE" : "MINISTRY_UPDATE",
    targetType: "ministry",
    targetId: u.id,
    message: statusToggled
      ? `${viewer.name || viewer.userId} toggled ministry status to ${u.status} (${u.name}).`
      : `${viewer.name || viewer.userId} updated ministry ${u.name}.`,
    meta: { name: u.name, status: u.status, description: u.description, avatarUri: u.avatarUri, mediaAccess: (u as any).mediaAccess },
  } as any);

  return json<Ministry>({ ok: true, data: u });
}

/* =========================
   DELETE /api/church/ministries?id=...
   ========================= */

export async function DELETE(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const url = new URL(req.url);
  const mid = String(url.searchParams.get("id") || "").trim();
  if (!mid) return json({ ok: false, error: "Missing id" } satisfies ApiErr, { status: 400 });

  let removed: Ministry | null = null;

  try {
    await updateJsonFile<Ministry[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const idx = list.findIndex((m) => m.id === mid && m.churchId === churchId);
        if (idx < 0) return list;

        removed = list[idx];
        return list.filter((m) => !(m.id === mid && m.churchId === churchId));
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  if (!removed) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  const r = removed as any as Ministry;

  await logAudit({
    req,
    viewer,
    churchId,
    action: "MINISTRY_DELETE",
    targetType: "ministry",
    targetId: r.id,
    message: `${viewer.name || viewer.userId} deleted ministry ${r.name}.`,
    meta: { name: r.name },
  } as any);

  return json({ ok: true, data: { id: mid } });
}
