import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  evaluateSokoPolicyConsent,
  parseSokoConsentClientContext,
  SOKO_CURRENT_POLICY_VERSIONS,
} from "@/app/api/_lib/sokoLegalPolicy";
import {
  acceptedVersionsFromConsent,
  dbAcceptSokoLegalConsent,
  dbLatestSokoLegalConsent,
  sokoConsentMatchesCurrent,
} from "@/app/api/_lib/store/sokoLegalConsentDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function publicConsent(record: Awaited<ReturnType<typeof dbLatestSokoLegalConsent>>) {
  if (!record) return null;
  return {
    acceptedAt: record.acceptedAt,
    versions: {
      termsVersion: record.termsVersion,
      privacyVersion: record.privacyVersion,
      marketplaceRulesVersion: record.marketplaceRulesVersion,
      safetyVersion: record.safetyVersion,
    },
    appVersion: record.appVersion,
    platform: record.platform,
    locale: record.locale,
  };
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const record = await dbLatestSokoLegalConsent(auth.viewer.userId);
    const currentAccepted = sokoConsentMatchesCurrent(record);
    const evaluation = evaluateSokoPolicyConsent({
      current: SOKO_CURRENT_POLICY_VERSIONS,
      accepted: acceptedVersionsFromConsent(record),
    });
    return reply({
      ok: true,
      current: SOKO_CURRENT_POLICY_VERSIONS,
      currentAccepted,
      consent: publicConsent(record),
      enforcement: evaluation.enforcement,
      blocking: evaluation.blocking,
    });
  } catch (error: any) {
    console.error("KRISTO_SOKO_LEGAL_CONSENT_GET_FAILED", {
      error: String(error?.message || error),
    });
    return reply(
      { ok: false, error: "Could not load SOKO policy consent." },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const context = parseSokoConsentClientContext(body);

  try {
    const accepted = await dbAcceptSokoLegalConsent({
      userId: auth.viewer.userId,
      appVersion: context.appVersion,
      platform: context.platform,
      locale: context.locale,
    });
    const evaluation = evaluateSokoPolicyConsent({
      current: SOKO_CURRENT_POLICY_VERSIONS,
      accepted: acceptedVersionsFromConsent(accepted.record),
    });
    return reply({
      ok: true,
      duplicate: accepted.duplicate,
      current: SOKO_CURRENT_POLICY_VERSIONS,
      currentAccepted: true,
      consent: publicConsent(accepted.record),
      enforcement: evaluation.enforcement,
      blocking: evaluation.blocking,
    });
  } catch (error: any) {
    console.error("KRISTO_SOKO_LEGAL_CONSENT_POST_FAILED", {
      error: String(error?.message || error),
    });
    return reply(
      { ok: false, error: "Could not record SOKO policy consent." },
      500
    );
  }
}
