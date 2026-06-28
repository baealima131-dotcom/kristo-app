import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  isAcceptedAgentStatus,
  listAgentsByLinkedUserId,
} from "@/app/api/_lib/offlineActivationAgentStore";
import { listPendingInvitationsForUser } from "@/app/api/_lib/offlineActivationInvitations";
import { getPlatformRole } from "@/app/api/_lib/platformRoles";
import { guardAuth } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  const platformRole = await getPlatformRole(userId);
  const registrations = await listAgentsByLinkedUserId(userId);
  const acceptedRegistrations = registrations.filter((row) => isAcceptedAgentStatus(row.status));
  const pendingInvitations = (await listPendingInvitationsForUser(userId)).filter(
    (row) => row.role === "Agent" && row.status === "pending"
  );

  return json({
    ok: true,
    platformRole: platformRole || null,
    hasAgentRole: platformRole === "Agent",
    hasAcceptedRegistration: acceptedRegistrations.length > 0,
    canOpenWorkspace: platformRole === "Agent" && acceptedRegistrations.length > 0,
    pendingInvitations,
    registrations,
  });
}
