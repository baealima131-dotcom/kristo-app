import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

type BankedItem = {
  id: string;
  churchId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

const FILE_NAME = "church_banked.json";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function makeId() {
  return `banked_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const all = await readJsonFile<BankedItem[]>(FILE_NAME, []);
  const data = all.filter((x) => x.churchId === ctxOrRes.churchId);

  return json({ ok: true, data });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({} as any));

  const title = String(body?.title || "").trim();
  const status = String(body?.status || "active").trim();

  if (!title) {
    return json({ ok: false, error: "Missing title" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const created: BankedItem = {
    id: makeId(),
    churchId: ctxOrRes.churchId,
    title,
    status,
    createdAt: now,
    updatedAt: now,
    createdBy: ctxOrRes.viewer.userId,
  };

  await updateJsonFile<BankedItem[]>(
    FILE_NAME,
    (current) => [created, ...(Array.isArray(current) ? current : [])],
    []
  );

  return json({
    ok: true,
    message: "Banked item created.",
    data: created,
  });
}
