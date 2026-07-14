import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guardPlatformOfflineActivation,
} from "@/app/api/_lib/rbac";

import {
  getUserById,
} from "@/app/api/auth/_lib/session";

import {
  getProfile,
} from "@/app/api/auth/_lib/profile";
import {
  dbListPendingSafetySupervisorInvitations,
  dbListSafetyRoles,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbGetSafetySupervisorDashboard,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardPlatformOfflineActivation(
      req,
      ["System_Admin"]
    );

  if (auth instanceof NextResponse) {
    return auth;
  }

  const [
    supervisors,
    pendingInvitations,
  ] = await Promise.all([
    dbListSafetyRoles(
      "Safety_Supervisor"
    ),
    dbListPendingSafetySupervisorInvitations(),
  ]);

  const enrichedSupervisors =
    await Promise.all(
      supervisors.map(async (supervisor: any) => {
        const supervisorUserId =
          String(
            supervisor?.userId ||
            supervisor?.user_id ||
            ""
          ).trim();

        const [
          dashboard,
          authUser,
          kristoProfile,
        ] = await Promise.all([
          dbGetSafetySupervisorDashboard(
            supervisorUserId
          ),

          supervisorUserId
            ? getUserById(
                supervisorUserId
              ).catch(() => null)
            : Promise.resolve(null),

          supervisorUserId
            ? getProfile(
                supervisorUserId
              ).catch(() => null)
            : Promise.resolve(null),
        ]);

        const authRow: any =
          authUser || {};

        const profileRow: any =
          kristoProfile || {};

        const fullName =
          String(
            profileRow?.fullName ||
            authRow?.fullName ||
            authRow?.displayName ||
            authRow?.name ||
            supervisor?.fullName ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();

        const kristoId =
          String(
            profileRow?.userCode ||
            authRow?.kristoId ||
            supervisor?.kristoId ||
            ""
          )
            .trim()
            .toUpperCase();

        const avatarUrl =
          String(
            profileRow?.avatarUrl ||
            authRow?.avatarUrl ||
            authRow?.avatarUri ||
            authRow?.profileImage ||
            authRow?.photoURL ||
            ""
          ).trim();

        return {
          ...supervisor,

          userId:
            supervisorUserId,

          fullName:
            fullName || undefined,

          kristoId:
            kristoId || undefined,

          avatarUrl:
            avatarUrl || undefined,

          /*
           * Keep avatarUri too for backward
           * compatibility with the current mobile UI.
           */
          avatarUri:
            avatarUrl || undefined,

          counts: {
            assigned: Number(
              dashboard?.counts?.assigned || 0
            ),

            open: Number(
              dashboard?.counts?.open || 0
            ),

            inReview: Number(
              dashboard?.counts?.inReview || 0
            ),

            resolved: Number(
              dashboard?.counts?.resolved || 0
            ),

            highPriority: Number(
              dashboard?.counts?.highPriority || 0
            ),

            escalated: Number(
              dashboard?.counts?.escalated || 0
            ),

            activeAgents: Number(
              dashboard?.counts?.activeAgents || 0
            ),

            pendingAgents: Number(
              dashboard?.counts?.pendingAgents || 0
            ),

            totalAssigned:
              Array.isArray(dashboard?.reports)
                ? dashboard.reports.length
                : 0,
          },
        };
      })
    );

  return NextResponse.json(
    {
      ok: true,

      supervisors:
        enrichedSupervisors,

      pendingInvitations,

      counts: {
        active:
          enrichedSupervisors.length,

        pending:
          pendingInvitations.length,
      },
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, no-cache, must-revalidate",
      },
    }
  );
}
