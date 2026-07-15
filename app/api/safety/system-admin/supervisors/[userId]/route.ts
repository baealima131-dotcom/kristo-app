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
  dbListSafetyRoles,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbGetSafetySupervisorDashboard,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  context: {
    params:
      Promise<{
        userId: string;
      }>;
  }
) {
  const auth =
    await guardPlatformOfflineActivation(
      req,
      ["System_Admin"]
    );

  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const params =
      await context.params;

    const supervisorUserId =
      decodeURIComponent(
        String(
          params?.userId || ""
        )
      ).trim();

    if (!supervisorUserId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Safety Supervisor user ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    const roles =
      await dbListSafetyRoles(
        "Safety_Supervisor"
      );

    const role =
      roles.find(
        (row: any) =>
          String(
            row?.userId ||
            row?.user_id ||
            ""
          ).trim() ===
          supervisorUserId
      );

    if (!role) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Safety Supervisor was not found.",
        },
        {
          status: 404,
        }
      );
    }

    const roleRow: any =
      role;

    const [
      dashboard,
      authUser,
      profile,
    ] = await Promise.all([
      dbGetSafetySupervisorDashboard(
        supervisorUserId
      ),

      getUserById(
        supervisorUserId
      ).catch(() => null),

      getProfile(
        supervisorUserId
      ).catch(() => null),
    ]);

    const authRow: any =
      authUser || {};

    const profileRow: any =
      profile || {};

    const fullName =
      String(
        profileRow?.fullName ||
        authRow?.fullName ||
        authRow?.displayName ||
        authRow?.name ||
        roleRow?.fullName ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();

    const kristoId =
      String(
        profileRow?.userCode ||
        authRow?.kristoId ||
        roleRow?.kristoId ||
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

    return NextResponse.json(
      {
        ok: true,

        supervisor: {
          ...role,

          userId:
            supervisorUserId,

          fullName:
            fullName ||
            undefined,

          kristoId:
            kristoId ||
            undefined,

          avatarUrl:
            avatarUrl ||
            undefined,

          avatarUri:
            avatarUrl ||
            undefined,
        },

        dashboard,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
          "Could not load supervisor details."
        ),
      },
      {
        status: 500,
      }
    );
  }
}
