import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  listSupervisorSummaries,
  readActivationCodeStoreForDebug,
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

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { supervisors, availableUnassigned } = await listSupervisorSummaries();
  const store = await readActivationCodeStoreForDebug();
  const storeDebug = buildActivationStoreRouteDebug("supervisors-load", store, {
    availableUnassigned,
    supervisorCount: supervisors.length,
  });
  logActivationRouteDiagnostics(storeDebug);

  return json({
    ok: true,
    supervisors,
    count: supervisors.length,
    availableUnassigned,
    _storeDebug: storeDebug,
  });
}
