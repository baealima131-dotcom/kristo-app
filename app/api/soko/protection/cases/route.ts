import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { parseOpenProtectionCaseBody } from "@/app/api/_lib/sokoProtectionPolicy";
import {
  dbListSokoProtectionCasesForUser,
  dbOpenSokoProtectionCase,
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

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const cases = await dbListSokoProtectionCasesForUser(auth.viewer.userId);
    return reply({
      ok: true,
      cases: cases.map((row) => publicProtectionCaseView(row)),
      enforcement: { mode: "observe", blocksOrderFulfillment: false },
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load protection cases.",
      },
      503
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = parseOpenProtectionCaseBody(body);
    if (!parsed.ok) {
      return reply(
        { ok: false, error: parsed.error, code: parsed.code },
        parsed.status
      );
    }

    const result = await dbOpenSokoProtectionCase({
      actorUserId: auth.viewer.userId,
      orderId: parsed.orderId,
      requestType: parsed.requestType as
        | "cancellation"
        | "return"
        | "dispute",
      reasonCode: parsed.reasonCode,
      description: parsed.description,
      buyerUserId: (body as { buyerUserId?: unknown })?.buyerUserId,
      sellerUserId: (body as { sellerUserId?: unknown })?.sellerUserId,
      amount: (body as { amount?: unknown })?.amount,
      currency: (body as { currency?: unknown })?.currency,
      productId: (body as { productId?: unknown })?.productId,
      resolutionCode: (body as { resolutionCode?: unknown })?.resolutionCode,
      outcome: (body as { outcome?: unknown })?.outcome,
    });

    return reply(
      {
        ok: true,
        created: result.created,
        idempotent: result.idempotent,
        case: publicProtectionCaseView(result.case),
      },
      result.created ? 201 : 200
    );
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not open protection case.",
        code: errorCode(error),
      },
      errorStatus(error)
    );
  }
}
