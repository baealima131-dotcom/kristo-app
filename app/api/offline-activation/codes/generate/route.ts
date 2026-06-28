import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  generateActivationCodeBatch,
  isAllowedCountryCode,
  isAllowedDurationMonths,
  readActivationCodeStoreForDebug,
  type ActivationCountryCode,
  type ActivationDurationMonths,
} from "@/app/api/_lib/offlineActivationCodeStore";
import {
  buildActivationStoreRouteDebug,
  logActivationRouteDiagnostics,
} from "@/app/api/_lib/offlineActivationStoreDiagnostics";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const countryCode = String(body?.countryCode || "").trim().toUpperCase();
  const durationMonths = Number(body?.durationMonths);
  const quantity = Number(body?.quantity);

  if (!isAllowedCountryCode(countryCode)) {
    return json({ ok: false, error: "Invalid countryCode. Use BDI, CD, TZ, or US." }, { status: 400 });
  }
  if (!isAllowedDurationMonths(durationMonths)) {
    return json({ ok: false, error: "Invalid durationMonths. Use 1, 3, 6, or 12." }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    return json({ ok: false, error: "Quantity must be at least 1." }, { status: 400 });
  }

  try {
    const result = await generateActivationCodeBatch({
      countryCode: countryCode as ActivationCountryCode,
      durationMonths: durationMonths as ActivationDurationMonths,
      quantity: Math.floor(quantity),
      createdByUserId: ctxOrRes.viewer.userId,
    });

    const store = await readActivationCodeStoreForDebug();
    const storeDebug = buildActivationStoreRouteDebug("generate-after-save", store, {
      generatedBatchId: result.batch.batchId,
      generatedCount: result.codes.length,
      firstGeneratedCodeStatus: result.codes[0]?.status || null,
    });
    logActivationRouteDiagnostics(storeDebug);

    return json({
      ok: true,
      batch: result.batch,
      codes: result.codes,
      _storeDebug: storeDebug,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to generate codes");
    const status = message.includes("Quantity") ? 400 : 500;
    return json({ ok: false, error: message }, { status });
  }
}
