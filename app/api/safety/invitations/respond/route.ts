import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";
import {
  dbRespondToSafetyInvitation,
} from "@/app/api/_lib/store/safetyDb";

import {
  dbCreateSupervisorAgent,
  dbRemoveSupervisorAgent,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const body =
    await req.json().catch(() => ({}));

  const invitationId = String(
    body?.invitationId || ""
  ).trim();

  const action = String(
    body?.action || ""
  ).trim().toLowerCase();

  if (
    !invitationId ||
    !["accept", "decline"].includes(
      action
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Invitation ID and a valid action are required.",
      },
      { status: 400 }
    );
  }

  try {
    const invitation =
      await dbRespondToSafetyInvitation({
        invitationId,
        inviteeUserId:
          auth.viewer.userId,
        action:
          action as
            | "accept"
            | "decline",
      });

    if (
      invitation.role ===
      "Safety_Agent"
    ) {
      if (action === "accept") {
        await dbCreateSupervisorAgent({
          supervisorUserId:
            invitation.invitedByUserId,

          agentUserId:
            invitation.inviteeUserId,

          agentKristoId:
            invitation.inviteeKristoId,

          churchId:
            invitation.churchId,

          status: "active",
        });
      } else {
        await dbRemoveSupervisorAgent({
          supervisorUserId:
            invitation.invitedByUserId,

          agentUserId:
            invitation.inviteeUserId,

          churchId:
            invitation.churchId,
        });
      }
    }

    console.log(
      "KRISTO_SAFETY_INVITATION_RESPONDED",
      {
        invitationId,
        userId:
          auth.viewer.userId,
        action,
        role:
          invitation.role,
        churchId:
          invitation.churchId,
      }
    );

    return NextResponse.json({
      ok: true,
      invitation,
      safetyRole:
        action === "accept"
          ? invitation.role
          : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not respond to invitation."
        ),
      },
      { status: 400 }
    );
  }
}
