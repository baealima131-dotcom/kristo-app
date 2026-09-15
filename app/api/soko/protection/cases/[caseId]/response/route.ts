import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { cleanSokoProtectionText } from "@/app/api/_lib/sokoProtectionPolicy";
import {
  dbRespondSokoProtectionCase,
  publicProtectionCaseView,
} from "@/app/api/_lib/store/sokoProtectionDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status || 0);
  return status >= 400 && status < 600 ? status : 400;
}

function errorCode(error: unknown) {
  return String((error as { code?: string })?.code || "") || undefined;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ caseId: string }> }
) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { caseId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const responseKindRaw = cleanSokoProtectionText(
      (body as { responseKind?: unknown })?.responseKind,
      40
    );
    const responseKind =
      responseKindRaw === "acknowledge" ||
      responseKindRaw === "counter_evidence" ||
      responseKindRaw === "decline_request"
        ? responseKindRaw
        : "";

    if (!responseKind) {
      return reply(
        {
          ok: false,
          error:
            "responseKind must be acknowledge, counter_evidence, or decline_request.",
          code: "invalid_response_kind",
        },
        400
      );
    }

    const updated = await dbRespondSokoProtectionCase({
      caseId,
      actorUserId: auth.viewer.userId,
      responseKind,
      note: String((body as { note?: unknown })?.note || ""),
      resolutionCode: (body as { resolutionCode?: unknown })?.resolutionCode,
      outcome: (body as { outcome?: unknown })?.outcome,
      closeCase: (body as { closeCase?: unknown })?.closeCase,
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
            : "Could not record seller response.",
        code: errorCode(error),
      },
      errorStatus(error)
    );
  }
}
