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
  inviteSafetySupervisor,
} from "@/app/api/_lib/safetyAdmin";

export const runtime = "nodejs";

export async function POST(
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

  const body =
    await req.json().catch(() => ({}));

  const kristoId = String(
    body?.kristoId || ""
  ).trim();

  const churchId = String(
    body?.churchId || ""
  ).trim();

  if (!kristoId || !churchId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "KRISTO ID and Church ID are required.",
      },
      { status: 400 }
    );
  }

  try {
    const result =
      await inviteSafetySupervisor(
        kristoId,
        churchId,
        auth.viewer.userId
      );

    console.log(
      "KRISTO_SAFETY_SUPERVISOR_INVITE_CREATED",
      {
        byUserId: auth.viewer.userId,
        inviteeUserId:
          result.user.userId,
        kristoId:
          result.user.kristoId,
        churchId:
          result.user.churchId,
        outcome: result.outcome,
      }
    );

    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      supervisor: {
        userId:
          result.user.userId,
        kristoId:
          result.user.kristoId,
        churchId:
          result.user.churchId,
        fullName:
          result.user.fullName,
        invitationStatus:
          result.outcome ===
          "alreadySupervisor"
            ? "accepted"
            : "pending",
        invitationId:
          result.invitation?.id ||
          null,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not invite Safety Supervisor."
        ),
      },
      { status: 400 }
    );
  }
}
