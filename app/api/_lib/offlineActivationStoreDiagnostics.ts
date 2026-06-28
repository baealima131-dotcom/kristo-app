import {
  countAssignableActivationCodes,
  type ActivationCode,
  type OfflineActivationCodeStore,
} from "@/app/api/_lib/offlineActivationCodeStore";
import {
  getOfflineActivationStoreDebugInfo,
  OFFLINE_ACTIVATION_CODES_STORE_KEY,
  resolveOfflineActivationStoreMode,
} from "@/app/api/_lib/store/offlineActivationDb";

/** Bump when changing activation store wiring so logs prove which build is running. */
export const ACTIVATION_STORE_IMPL_VERSION = "durable-v3-route-diagnostics";

export type ActivationCodeSample = {
  code: string;
  status: ActivationCode["status"];
  assignedSupervisorUserId: string | null;
  assignedAgentUserId: string | null;
  redeemedAt: string | null;
  disabledAt: string | null;
};

export type ActivationStoreRouteDebug = {
  implVersion: string;
  route: string;
  storeKey: string;
  storeMode: ReturnType<typeof resolveOfflineActivationStoreMode>;
  dataDir: string;
  runtimePath: string;
  bundledPath: string;
  serverless: boolean;
  batchCount: number;
  totalCodeCount: number;
  assignableCount: number;
  availableUnassigned: number;
  availableStatusCount: number;
  sampleCodes: ActivationCodeSample[];
  extra?: Record<string, unknown>;
};

function flattenCodes(store: OfflineActivationCodeStore): ActivationCode[] {
  return (store.batches || []).flatMap((batch) => batch.codes || []);
}

function sampleCode(code: ActivationCode): ActivationCodeSample {
  return {
    code: String(code.code || ""),
    status: code.status,
    assignedSupervisorUserId: code.assignedSupervisorUserId ?? null,
    assignedAgentUserId: code.assignedAgentUserId ?? null,
    redeemedAt: code.redeemedAt ?? null,
    disabledAt: code.status === "disabled" ? String(code.redeemedAt || code.createdAt || "") || null : null,
  };
}

export function buildActivationStoreRouteDebug(
  route: string,
  store: OfflineActivationCodeStore,
  extra?: Record<string, unknown>
): ActivationStoreRouteDebug {
  const codes = flattenCodes(store);
  const assignableCount = countAssignableActivationCodes(codes);
  const storeInfo = getOfflineActivationStoreDebugInfo(OFFLINE_ACTIVATION_CODES_STORE_KEY);

  return {
    implVersion: ACTIVATION_STORE_IMPL_VERSION,
    route,
    storeKey: storeInfo.storeKey,
    storeMode: storeInfo.mode,
    dataDir: storeInfo.dataDir,
    runtimePath: storeInfo.runtimePath,
    bundledPath: storeInfo.bundledPath,
    serverless: storeInfo.serverless,
    batchCount: store.batches.length,
    totalCodeCount: codes.length,
    assignableCount,
    availableUnassigned: assignableCount,
    availableStatusCount: codes.filter((row) => row.status === "available").length,
    sampleCodes: codes.slice(0, 3).map(sampleCode),
    extra,
  };
}

export function logActivationRouteDiagnostics(debug: ActivationStoreRouteDebug) {
  const payload = {
    implVersion: debug.implVersion,
    route: debug.route,
    storeMode: debug.storeMode,
    runtimePath: debug.runtimePath,
    dataDir: debug.dataDir,
    bundledPath: debug.bundledPath,
    serverless: debug.serverless,
    batchCount: debug.batchCount,
    totalCodeCount: debug.totalCodeCount,
    assignableCount: debug.assignableCount,
    availableUnassigned: debug.availableUnassigned,
    availableStatusCount: debug.availableStatusCount,
    sampleCodes: debug.sampleCodes,
    ...(debug.extra || {}),
  };

  console.log(`[KRISTO] activation route ${debug.route}`, payload);

  if (debug.assignableCount === 0 && debug.totalCodeCount > 0) {
    console.warn(`[KRISTO] activation route ${debug.route} assignable pool empty with codes present`, payload);
  }
}
