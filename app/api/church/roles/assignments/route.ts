// app/api/church/roles/assignments/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import type {
  RoleAssignment,
  RoleAssignmentStatus,
  RoleId,
} from "@/app/(app)/dashboard/church/roles/_lib/roles.types";

/* =========================
   DEV STORE (persist in dev via globalThis)
   ========================= */

 
declare global {
   
  var __KRISTO_ROLE_ASSIGNMENTS__: RoleAssignment[] | undefined;
}

function getStore() {
  if (!globalThis.__KRISTO_ROLE_ASSIGNMENTS__) {
    globalThis.__KRISTO_ROLE_ASSIGNMENTS__ = [];
  }
  return globalThis.__KRISTO_ROLE_ASSIGNMENTS__;
}

function isoNow() {
  return new Date().toISOString();
}

function id(prefix = "ra") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

function err(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

const VALID_STATUSES: RoleAssignmentStatus[] = ["Active", "Suspended", "Ended"];

const VALID_ROLE_IDS: RoleId[] = [
  "youth_leader",
  "choir_leader",
  "women_leader",
  "prayer_leader",
  "usher_leader",
  "media_leader",
  "secretary",
  "treasurer",
  "evangelism_leader",
];

// Server-side truth for ministry-scoped roles
const MINISTRY_ROLE_IDS = new Set<RoleId>([
  "youth_leader",
  "choir_leader",
  "women_leader",
  "prayer_leader",
  "usher_leader",
  "media_leader",
  "evangelism_leader",
]);

function isMinistryRole(roleId: RoleId) {
  return MINISTRY_ROLE_IDS.has(roleId);
}

type PatchAction = "end" | "suspend" | "resume";

/* =========================
   GET
   ========================= */

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const ctx = ctxOrRes;
  const url = new URL(req.url);

  const status = url.searchParams.get("status");
  const roleId = url.searchParams.get("roleId");
  const memberId = url.searchParams.get("memberId");
  const ministryId = url.searchParams.get("ministryId");

  const STORE = getStore();

  let rows = STORE.filter((a) => a.churchId === ctx.churchId);

  if (status && VALID_STATUSES.includes(status as any)) {
    rows = rows.filter((a) => a.status === (status as any));
  }

  if (roleId && VALID_ROLE_IDS.includes(roleId as any)) {
    rows = rows.filter((a) => a.roleId === (roleId as any));
  }

  if (memberId) rows = rows.filter((a) => a.memberId === memberId);

  if (ministryId) rows = rows.filter((a) => String(a.ministryId || "") === String(ministryId));

  rows = rows.sort((a, b) => (a.assignedAt < b.assignedAt ? 1 : -1));

  return ok(rows);
}

/* =========================
   POST (assign role)
   ========================= */

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const ctx = ctxOrRes;

  const body = await req.json().catch(() => null);
  if (!body) return err("Invalid JSON body");

  const STORE = getStore();

  const roleId = body?.roleId as RoleId | undefined;
  const memberId = typeof body?.memberId === "string" ? body.memberId.trim() : "";
  const memberName = typeof body?.memberName === "string" ? body.memberName.trim() : "";
  const ministryIdRaw = typeof body?.ministryId === "string" ? body.ministryId.trim() : "";
  const ministryNameRaw = typeof body?.ministryName === "string" ? body.ministryName.trim() : "";

  if (!roleId || !VALID_ROLE_IDS.includes(roleId)) return err("Invalid roleId");
  if (!memberId || !memberName) return err("memberId & memberName required");

  // Ministry-scoped roles MUST have ministryId
  const needsMinistry = isMinistryRole(roleId);
  const ministryId = needsMinistry ? (ministryIdRaw ? ministryIdRaw : "") : "";
  const ministryName = needsMinistry ? (ministryNameRaw ? ministryNameRaw : "") : "";

  if (needsMinistry && !ministryId) return err("ministryId required for this role");

  // For church-scope roles, ignore any ministry data
  const finalMinistryId = needsMinistry ? ministryId : undefined;
  const finalMinistryName = needsMinistry ? (ministryName || undefined) : undefined;

  const exists = STORE.some(
    (a) =>
      a.churchId === ctx.churchId &&
      a.roleId === roleId &&
      a.memberId === memberId &&
      a.status === "Active" &&
      String(a.ministryId || "") === String(finalMinistryId || "")
  );
  if (exists) return err("Assignment already exists", 409);

  const record: RoleAssignment = {
    id: id(),
    churchId: ctx.churchId,
    roleId,
    memberId,
    memberName,
    ministryId: finalMinistryId,
    ministryName: finalMinistryName,
    assignedByPastorId: ctx.viewer.userId,
    assignedByPastorName: ctx.viewer.name || "Pastor",
    status: "Active",
    assignedAt: isoNow(),
  };

  STORE.unshift(record);
  return ok(record, { status: 201 });
}

/* =========================
   PATCH (end / suspend / resume)
   ========================= */

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const ctx = ctxOrRes;

  const body = await req.json().catch(() => null);
  if (!body) return err("Invalid JSON body");

  const STORE = getStore();

  const assignmentId = typeof body?.id === "string" ? body.id.trim() : "";
  const action = body?.action as PatchAction | undefined;

  if (!assignmentId) return err("id is required");
  if (action !== "end" && action !== "suspend" && action !== "resume") {
    return err("Invalid action. Use: end | suspend | resume", 400);
  }

  const idx = STORE.findIndex((a) => a.id === assignmentId);
  if (idx < 0) return err("Assignment not found", 404);

  const current = STORE[idx];

  // Security: ensure same church scope
  if (current.churchId !== ctx.churchId) return err("Not found", 404);

  // State rules
  if (current.status === "Ended") return err("Cannot modify ended assignment", 409);
  if (action === "suspend" && current.status === "Suspended") return ok(current);
  if (action === "resume" && current.status === "Active") return ok(current);

  if (action === "end") {
    STORE[idx] = { ...current, status: "Ended", endsAt: isoNow() };
  } else if (action === "suspend") {
    STORE[idx] = { ...current, status: "Suspended" };
  } else if (action === "resume") {
    STORE[idx] = { ...current, status: "Active" };
  }

  return ok(STORE[idx]);
}

/* =========================
   DELETE
   Supports:
     A) Body reset: { action: "reset" }
     B) Query delete: ?id=one OR ?ids=a,b,c
   ========================= */

export async function DELETE(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const ctx = ctxOrRes;
  const url = new URL(req.url);

  const STORE = getStore();

  // 1) BULK RESET via JSON body (safe)
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  if (action === "reset") {
    const before = STORE.length;

    globalThis.__KRISTO_ROLE_ASSIGNMENTS__ = STORE.filter((a) => a.churchId !== ctx.churchId);

    const after = globalThis.__KRISTO_ROLE_ASSIGNMENTS__!.length;
    const deleted = before - after;

    return ok({ deleted: true, count: deleted, mode: "reset" });
  }

  // 2) Query delete (?id / ?ids)
  const idParam = url.searchParams.get("id");
  const idsParam = url.searchParams.get("ids");

  const ids: string[] = [];
  if (typeof idsParam === "string" && idsParam.trim()) {
    for (const part of idsParam.split(",")) {
      const v = part.trim();
      if (v) ids.push(v);
    }
  } else if (typeof idParam === "string" && idParam.trim()) {
    ids.push(idParam.trim());
  }

  if (ids.length === 0) {
    return err('Provide body {"action":"reset"} OR query ?id= / ?ids=', 400);
  }

  const before = STORE.length;

  globalThis.__KRISTO_ROLE_ASSIGNMENTS__ = STORE.filter((a) => {
    if (a.churchId !== ctx.churchId) return true;
    return !ids.includes(a.id);
  });

  const after = globalThis.__KRISTO_ROLE_ASSIGNMENTS__!.length;
  const deleted = before - after;

  return ok({ deleted: true, count: deleted, mode: "ids" });
}
