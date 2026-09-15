import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { cleanSokoProtectionText } from "@/app/api/_lib/sokoProtectionPolicy";
import { dbAddSokoProtectionEvidence } from "@/app/api/_lib/store/sokoProtectionDb";
import type {
  SokoProtectionEvidenceType,
  SokoProtectionTrustedReferenceType,
} from "@/app/api/_lib/sokoProtectionPolicy";

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

const EVIDENCE_TYPES = new Set([
  "payment_proof",
  "chat_message",
  "order_legacy_payment_proof",
  "caption_note",
  "shipping_note",
]);

const REF_TYPES = new Set([
  "payment_proof",
  "order_legacy_payment_proof",
  "chat_message",
  "none",
]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ caseId: string }> }
) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { caseId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const evidenceType = cleanSokoProtectionText(
      (body as { evidenceType?: unknown })?.evidenceType,
      40
    );
    const trustedReferenceType = cleanSokoProtectionText(
      (body as { trustedReferenceType?: unknown })?.trustedReferenceType ||
        "none",
      40
    );

    if (!EVIDENCE_TYPES.has(evidenceType)) {
      return reply(
        {
          ok: false,
          error: "Invalid evidenceType.",
          code: "invalid_evidence_type",
        },
        400
      );
    }
    if (!REF_TYPES.has(trustedReferenceType)) {
      return reply(
        {
          ok: false,
          error: "Invalid trustedReferenceType.",
          code: "invalid_reference_type",
        },
        400
      );
    }

    const evidence = await dbAddSokoProtectionEvidence({
      caseId,
      actorUserId: auth.viewer.userId,
      evidenceType: evidenceType as SokoProtectionEvidenceType,
      trustedReferenceType:
        trustedReferenceType as SokoProtectionTrustedReferenceType,
      trustedReferenceId: String(
        (body as { trustedReferenceId?: unknown })?.trustedReferenceId || ""
      ),
      caption: String((body as { caption?: unknown })?.caption || ""),
      resolutionCode: (body as { resolutionCode?: unknown })?.resolutionCode,
      outcome: (body as { outcome?: unknown })?.outcome,
      base64: (body as { base64?: unknown })?.base64,
      proofBase64: (body as { proofBase64?: unknown })?.proofBase64,
    });

    return reply({ ok: true, evidence }, 201);
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not add protection evidence.",
        code: errorCode(error),
      },
      errorStatus(error)
    );
  }
}
