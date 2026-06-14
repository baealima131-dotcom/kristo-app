import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/app/api/_lib/rbac";
import { setMemberRole } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

type ChurchRole = "Member" | "Leader" | "Church_Admin" | "Pastor" | "System_Admin";
type ApiErr = { ok: false; error: string; details?: unknown };

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isChurchRole(x: unknown): x is ChurchRole {
  return x === "Member" || x === "Leader" || x === "Church_Admin" || x === "Pastor" || x === "System_Admin";
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const ctx = ctxOrRes;
  const churchId = ctx.churchId;

  try {
    const body = await req.json().catch(() => null);
    const userId = String(body?.userId || "").trim();
    const role = body?.role;

    if (!userId) {
      return json({ ok: false, error: "userId is required" } satisfies ApiErr, { status: 400 });
    }

    if (!isChurchRole(role)) {
      return json(
        { ok: false, error: "Invalid role. Use Member | Leader | Church_Admin | Pastor | System_Admin" } satisfies ApiErr,
        { status: 400 }
      );
    }

    const updated = await setMemberRole(churchId, userId, role);

    if (!updated) {
      return json({ ok: false, error: "Membership not found or could not be updated" } satisfies ApiErr, { status: 404 });
    }

    const notification = await createNotification({
      churchId,
      type: "Generic",
      title: "Role updated",
      message: `Your church role was changed to ${String(role).replace(/_/g, " ")}.`,
      targetUserId: userId,
    });

    return json({
      ok: true,
      data: {
        churchId,
        userId,
        role,
        notification,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Failed to update membership role",
        details: error instanceof Error ? error.message : String(error),
      } satisfies ApiErr,
      { status: 500 }
    );
  }
}
