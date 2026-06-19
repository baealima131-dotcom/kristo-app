import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  readLiveJsonFile as readJsonFile,
  updateLiveJsonFile as updateJsonFile,
} from "@/app/api/_lib/store/liveDb";
import { rateLimit } from "@/app/api/_lib/rateLimit";

type McHostsRow = {
  assignmentId: string;
  churchId: string;
  hostUserIds: string[];
  updatedAt: string;
  updatedBy?: string;
};

type ApiErr = { ok: false; error: string; details?: unknown };
type ApiOk<T> = { ok: true; data: T };

const STORE_FILE = "mc-hosts.json";

function json<T>(data: ApiOk<T> | ApiErr, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function nowIso() {
  return new Date().toISOString();
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "mc_hosts", limit: 90, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } },
      { status: 429 }
    );
  }
  return null;
}

async function asBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return req.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function readAll(): Promise<McHostsRow[]> {
  const data = await readJsonFile<McHostsRow[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

function cleanHostIds(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const unique = Array.from(
    new Set(
      arr
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
  return unique.slice(0, 2);
}

export async function GET(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId } = ctxOrRes;
  const url = new URL(req.url);
  const assignmentId = String(url.searchParams.get("assignmentId") || "").trim();

  if (!assignmentId) return json({ ok: false, error: "Missing assignmentId" } satisfies ApiErr, { status: 400 });

  const all = await readAll();
  const row = all.find((x) => x.churchId === churchId && x.assignmentId === assignmentId);

  return json<McHostsRow>({
    ok: true,
    data: row || {
      assignmentId,
      churchId,
      hostUserIds: [],
      updatedAt: nowIso(),
    },
  });
}

export async function POST(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  const assignmentId = String(body.assignmentId || "").trim();
  const hostUserIds = cleanHostIds(body.hostUserIds);

  if (!assignmentId) return json({ ok: false, error: "assignmentId is required" } satisfies ApiErr, { status: 400 });
  if (hostUserIds.length > 2) return json({ ok: false, error: "Only 2 MC+ Hosts allowed" } satisfies ApiErr, { status: 400 });

  const allRows = await readAll();
  const existing = allRows.find((x) => x.churchId === churchId && x.assignmentId === assignmentId);
  const existingIds = Array.isArray(existing?.hostUserIds) ? existing.hostUserIds.map(String) : [];

  if (viewer.role === "Member") {
    const isCurrentHost = existingIds.includes(viewer.userId);
    const allowedQuitIds = existingIds.filter((id) => id !== viewer.userId);

    if (!isCurrentHost || JSON.stringify(hostUserIds) !== JSON.stringify(allowedQuitIds)) {
      return json({ ok: false, error: "Only leaders can manage MC+ Hosts. Hosts can only quit themselves." } satisfies ApiErr, { status: 403 });
    }
  }

  const updated: McHostsRow = {
    assignmentId,
    churchId,
    hostUserIds,
    updatedAt: nowIso(),
    updatedBy: viewer.userId,
  };

  await updateJsonFile<McHostsRow[]>(
    STORE_FILE,
    (rows) => {
      const safeRows = Array.isArray(rows) ? rows : [];
      const idx = safeRows.findIndex((x) => x.churchId === churchId && x.assignmentId === assignmentId);

      if (idx >= 0) {
        safeRows[idx] = updated;
        return safeRows;
      }

      return [...safeRows, updated];
    },
    []
  );

  return json<McHostsRow>({ ok: true, data: updated });
}
