import { NextRequest, NextResponse } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { cleanSokoProtectionText } from "@/app/api/_lib/sokoProtectionPolicy";
import type { SokoProtectionAdminAction } from "@/app/api/_lib/sokoProtectionPolicy";
import {
  dbAdminSokoProtectionCaseAction,
  publicProtectionCaseView,
} from "@/app/api/_lib/store/sokoProtectionDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" },
  });
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status || 0);
  return status >= 400 && status < 600 ? status : 400;
}

function errorCode(error: unknown) {
  return String((error as { code?: string })?.code || "") || undefined;
}

const ACTIONS = new Set([
  "request_evidence",
  "recommend_resolution",
  "mark_external_refund_pending",
  "report_external_refund_logged",
  "close_case",
]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ caseId: string }> }
) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const { caseId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const action = cleanSokoProtectionText(
      (body as { action?: unknown })?.action,
      60
    );

    if (!ACTIONS.has(action)) {
      return reply(
        {
          ok: false,
          error: "Invalid admin action.",
          code: "invalid_action",
        },
        400
      );
    }

    const updated = await dbAdminSokoProtectionCaseAction({
      caseId,
      actorUserId: auth.viewer.userId,
      action: action as SokoProtectionAdminAction,
      resolutionCode: String(
        (body as { resolutionCode?: unknown })?.resolutionCode || ""
      ),
      resolutionSummary: String(
        (body as { resolutionSummary?: unknown })?.resolutionSummary || ""
      ),
      note: String((body as { note?: unknown })?.note || ""),
    });

    return reply({
      ok: true,
      case: publicProtectionCaseView(updated),
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not apply admin protection action.",
        code: errorCode(error),
      },
      errorStatus(error)
    );
  }
}
