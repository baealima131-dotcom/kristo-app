import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  dbCreateSafetyReport,
} from "@/app/api/_lib/store/safetyReportDb";
import {
  getProfile,
} from "@/app/api/auth/_lib/profile";


import { guard, guardAuth } from "@/app/api/_lib/rbac";
import {
  ensureDirectMessageThreadFromRoomId,
  listDirectMessageInbox,
  getDirectMessageConversationSettings,
  markDirectMessageThreadRead,
  openDirectMessageThread,
  reportDirectMessageUser,
  resolveDirectMessagePeerPreview,
  updateDirectMessageConversationSettings,
} from "@/app/api/_lib/directMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function resolveReportedDmUserId(
  roomId: string,
  viewerUserId: string
) {
  const normalizedRoomId =
    String(roomId || "").trim();

  const normalizedViewerUserId =
    String(viewerUserId || "").trim();

  if (
    !normalizedRoomId.startsWith("dm:") ||
    !normalizedViewerUserId
  ) {
    return "";
  }

  const participants =
    normalizedRoomId
      .slice(3)
      .split("::")
      .map((value) =>
        String(value || "").trim()
      )
      .filter(Boolean);

  if (participants.length !== 2) {
    return "";
  }

  return (
    participants.find(
      (userId) =>
        userId !== normalizedViewerUserId
    ) || ""
  );
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const action = String(url.searchParams.get("action") || "").trim().toLowerCase();
  const viewerUserId = String(ctxOrRes.viewer.userId || "").trim();
  const churchId = String(ctxOrRes.churchId || "").trim();

  if (action === "settings") {
    const roomId = String(
      url.searchParams.get("roomId") || ""
    ).trim();

    if (!roomId) {
      return json(
        {
          ok: false,
          error: "roomId is required.",
        },
        { status: 400 }
      );
    }

    const settings =
      await getDirectMessageConversationSettings({
        churchId,
        roomId,
        userId: viewerUserId,
      });

    if (!settings) {
      return json(
        { ok: false, error: "Conversation not found." },
        { status: 404 }
      );
    }

    return json({ ok: true, data: settings });
  }

  if (action === "resolve") {
    const kristoId = String(url.searchParams.get("kristoId") || url.searchParams.get("kristoID") || "").trim();
    const lookupChurchId = String(url.searchParams.get("churchId") || url.searchParams.get("churchID") || "").trim();
    if (!kristoId || !lookupChurchId) {
      return json({ ok: false, error: "Kristo ID and Church ID are required." }, { status: 400 });
    }

    const peer = await resolveDirectMessagePeerPreview({
      kristoId,
      churchId: lookupChurchId,
    });

    if (!peer) {
      return json(
        { ok: false, error: "We could not find an active member with that Kristo ID in that church." },
        { status: 404 }
      );
    }

    if (peer.userId === viewerUserId) {
      return json({ ok: false, error: "You cannot start a chat with yourself." }, { status: 400 });
    }

    return json({ ok: true, data: peer });
  }

  // Inbox inclusion is participant-based. Session churchId is optional metadata
  // for same-church labels — never gate the list on it for cross-church DMs.
  try {
    const inbox =
      await listDirectMessageInbox({
        churchId,
        viewerUserId,
      });

    return json({
      ok: true,
      data: inbox,
    });
  } catch (error) {
    console.error(
      "KRISTO_DM_INBOX_ROUTE_FAILED",
      {
        churchId,
        viewerUserId,
        error:
          String(
            (error as any)?.message ||
            error
          ),
      }
    );

    /*
     * Inbox metadata failure must not break
     * an already-open DM conversation.
     */
    return json({
      ok: true,
      data: [],
      degraded: true,
    });
  }
}

export async function POST(req: NextRequest) {
  // Auth only — do not require shared/active church membership to open a DM.
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = (await req.json().catch(() => null)) as {
    targetUserId?: string;
    roomId?: string;
    churchId?: string;
    action?: string;
  } | null;

  const viewerUserId = String(ctxOrRes.viewer.userId || "").trim();
  const targetUserId = String(body?.targetUserId || "").trim();
  const roomId = String(body?.roomId || "").trim();
  const headerChurchId = String(
    (ctxOrRes.viewer as any)?.churchId ||
      req.headers.get("x-kristo-church-id") ||
      ""
  ).trim();
  const churchId = String(body?.churchId || headerChurchId || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "ensure" || roomId) {
    if (!roomId) {
      return json({ ok: false, error: "roomId is required." }, { status: 400 });
    }

    const thread = await ensureDirectMessageThreadFromRoomId({
      viewerUserId,
      churchId: churchId || "dm",
      roomId,
      intent: "repair",
    });

    if (!thread) {
      return json({ ok: false, error: "Could not open this conversation." }, { status: 400 });
    }

    return json({ ok: true, data: thread });
  }

  if (!targetUserId) {
    return json({ ok: false, error: "targetUserId is required." }, { status: 400 });
  }

  try {
    const thread = await openDirectMessageThread({
      viewerUserId,
      targetUserId,
      churchId,
    });
    return json({ ok: true, data: thread }, { status: 201 });
  } catch (error) {
    const message = String((error as Error)?.message || error || "Could not start chat.");
    let status = 400;
    if (message.includes("yourself")) status = 400;
    else if (message === "conversation_blocked") status = 403;
    else if (message.includes("not found")) status = 404;
    return json(
      {
        ok: false,
        error: message,
        ...(message === "conversation_blocked"
          ? { code: "conversation_blocked" }
          : {}),
      },
      { status }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = (await req.json().catch(() => null)) as {
    roomId?: string;
    churchId?: string;
    action?: string;
    reason?: string;
    details?: string;
  } | null;

  const action = String(
    body?.action || "read"
  ).trim().toLowerCase();

  const supportedActions = new Set([
    "read",
    "mute",
    "unmute",
    "block",
    "unblock",
    "clear",
    "delete",
    "restore",
    "report",
    "accept",
    "decline",
    "restart_request",
  ]);

  if (!supportedActions.has(action)) {
    return json(
      { ok: false, error: "Unsupported action." },
      { status: 400 }
    );
  }

  const roomId = String(body?.roomId || "").trim();
  const churchId = String(body?.churchId || ctxOrRes.churchId || "").trim();
  const viewerUserId = String(ctxOrRes.viewer.userId || "").trim();

  if (!roomId) {
    return json({ ok: false, error: "roomId is required." }, { status: 400 });
  }

  if (action === "report") {
    const reason = String(body?.reason || "").trim();

    if (!reason) {
      return json(
        { ok: false, error: "Report reason is required." },
        { status: 400 }
      );
    }

    const reported = await reportDirectMessageUser({
      churchId,
      roomId,
      reporterUserId: viewerUserId,
      reason,
      details: String(body?.details || "").trim(),
    });

    if (!reported) {
      return json(
        {
          ok: false,
          error: "Could not report user.",
        },
        {
          status: 400,
        }
      );
    }

    const reporterProfile =
      await getProfile(viewerUserId);

    const reporterKristoId =
      String(
        reporterProfile?.userCode || ""
      )
        .trim()
        .toUpperCase();

    if (!reporterKristoId) {
      return json(
        {
          ok: false,
          error:
            "Your KRISTO ID could not be verified.",
        },
        {
          status: 400,
        }
      );
    }

    const reportedUserId =
      String(
        (reported as any)
          ?.reportedUserId ||
        resolveReportedDmUserId(
          roomId,
          viewerUserId
        ) ||
        ""
      ).trim();

    if (!reportedUserId) {
      console.error(
        "KRISTO_DM_SAFETY_REPORT_TARGET_UNRESOLVED",
        {
          roomId,
          viewerUserId,
          churchId,
        }
      );

      return json(
        {
          ok: false,
          error:
            "The reported account could not be identified.",
        },
        {
          status: 400,
        }
      );
    }

    const reportedProfile =
      await getProfile(
        reportedUserId
      );

    const safetyReport =
      await dbCreateSafetyReport({
        reporterUserId:
          viewerUserId,

        reporterKristoId,

        reportedUserId:
          reportedUserId ||
          undefined,

        reportedKristoId:
          String(
            reportedProfile?.userCode || ""
          )
            .trim()
            .toUpperCase() ||
          undefined,

        churchId,

        sourceType:
          "direct_message",

        sourceId: roomId,
        sourceRoomId: roomId,

        targetType:
          "account",

        targetId:
          reportedUserId ||
          undefined,

        targetTitle:
          String(
            reportedProfile?.fullName ||
            reportedProfile?.userCode ||
            "Reported account"
          ).trim(),

        targetSubtitle:
          undefined,

        targetOwnerUserId:
          reportedUserId ||
          undefined,

        targetOwnerKristoId:
          String(
            reportedProfile?.userCode || ""
          )
            .trim()
            .toUpperCase() ||
          undefined,

        targetOwnerName:
          String(
            reportedProfile?.fullName || ""
          ).trim() ||
          undefined,

        targetThumbnailUri:
          String(
            (reportedProfile as any)
              ?.avatarUri ||
            (reportedProfile as any)
              ?.avatarUrl ||
            (reportedProfile as any)
              ?.profileImage ||
            (reportedProfile as any)
              ?.photoURL ||
            ""
          ).trim() ||
          undefined,

        category: reason,
        reason,

        description:
          String(
            body?.details || ""
          ).trim() ||
          `Direct-message user report: ${reason}`,

        priority:
          reason === "harassment"
            ? "high"
            : "normal",
      });

    console.log(
      "KRISTO_DM_SAFETY_REPORT_CREATED",
      {
        reportId:
          safetyReport.id,
        reportCode:
          safetyReport.reportCode,
        reporterUserId:
          viewerUserId,
        reporterKristoId,
        reportedUserId,
        churchId,
      }
    );

    return json({
      ok: true,
      report: {
        id:
          safetyReport.id,
        reportCode:
          safetyReport.reportCode,
        status:
          safetyReport.status,
        createdAt:
          safetyReport.createdAt,
      },
    });
  }

  if (action !== "read") {
    const settings =
      await updateDirectMessageConversationSettings({
        churchId,
        roomId,
        userId: viewerUserId,
        action: action as
          | "mute"
          | "unmute"
          | "block"
          | "unblock"
          | "clear"
          | "delete"
          | "restore"
          | "accept"
          | "decline"
          | "restart_request",
      });

    if (!settings) {
      const receiverOnly =
        action === "accept" || action === "decline";
      if (action === "restart_request") {
        return json(
          {
            ok: false,
            error: "Restart request persistence failed",
            code: "DM_REQUEST_RESTART_PERSISTENCE_FAILED",
          },
          { status: 400 }
        );
      }
      return json(
        {
          ok: false,
          error: receiverOnly
            ? "Only the recipient can accept or decline this message request."
            : "Could not update conversation.",
          ...(receiverOnly
            ? { code: "DM_REQUEST_RECEIVER_ONLY" }
            : {}),
        },
        { status: receiverOnly ? 403 : 400 }
      );
    }

    if (
      action === "restart_request" &&
      (settings.relationshipStatus !== "request_pending" ||
        settings.isRequestInitiator !== true)
    ) {
      return json(
        {
          ok: false,
          error: "Restart request persistence failed",
          code: "DM_REQUEST_RESTART_PERSISTENCE_FAILED",
        },
        { status: 400 }
      );
    }

    return json({ ok: true, data: settings });
  }

  const updated = await markDirectMessageThreadRead({
    churchId,
    roomId,
    userId: viewerUserId,
  });

  if (!updated) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "mark_read_failed",
      roomId,
      churchId,
      viewerUserId,
    });
    return json({ ok: false, error: "Could not mark conversation read." }, { status: 400 });
  }

  return json({ ok: true });
}
