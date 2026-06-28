import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getSupervisorAgent,
  isAcceptedAgentStatus,
  updateSupervisorAgent,
  type OfflineActivationAgentStatus,
} from "@/app/api/_lib/offlineActivationAgentStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function normalizeSupervisorAgentStatusUpdate(
  raw: unknown,
  current: OfflineActivationAgentStatus
): OfflineActivationAgentStatus | null {
  const statusRaw = String(raw || "").trim();
  if (statusRaw === "inactive") return "inactive";
  if (statusRaw === "accepted" || statusRaw === "active") return "accepted";
  if (statusRaw === current) return current;
  return null;
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Supervisor"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const agentId = String(body?.agentId || "").trim();
  if (!agentId) return json({ ok: false, error: "agentId is required." }, { status: 400 });

  const statusRaw = body?.status !== undefined ? String(body.status).trim() : undefined;

  try {
    const existing = await getSupervisorAgent(ctxOrRes.viewer.userId, agentId);
    if (!existing) return json({ ok: false, error: "Agent not found." }, { status: 404 });

    if (statusRaw !== undefined) {
      const nextStatus = normalizeSupervisorAgentStatusUpdate(statusRaw, existing.status);
      if (!nextStatus) {
        return json(
          { ok: false, error: "Only accepted agents can be set inactive, or inactive agents reactivated." },
          { status: 400 }
        );
      }
      if (existing.status === "pending" || existing.status === "declined") {
        return json(
          { ok: false, error: "Cannot change status until the agent accepts or declines the invitation." },
          { status: 400 }
        );
      }
      if (nextStatus === "inactive" && !isAcceptedAgentStatus(existing.status)) {
        return json({ ok: false, error: "Only accepted agents can be deactivated." }, { status: 400 });
      }
    }

    const agent = await updateSupervisorAgent({
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId,
      ...(statusRaw !== undefined
        ? { status: normalizeSupervisorAgentStatusUpdate(statusRaw, existing.status) || existing.status }
        : {}),
    });

    return json({ ok: true, agent });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to update agent") }, { status: 400 });
  }
}
