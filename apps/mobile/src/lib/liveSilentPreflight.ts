import type { Router } from "expo-router";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { fetchLiveKitToken, prefetchLiveKitToken } from "@/src/lib/liveKitTokenPrefetch";
import {
  logLivePreflightFastPathUsed,
  logSilentLivePreflightDone,
  logSilentLivePreflightStart,
  markLiveEnterTap,
} from "@/src/lib/liveKitPerf";
import {
  resolveLivePreflightModeFromRoute,
  resolveLivePreflightNeedsMicFromRoute,
  type LivePreflightMode,
} from "@/src/lib/livePreflightMode";
import {
  clearStaleLiveEndedFlag,
  markLiveRoomLiveKitConnecting,
  pinClaimEnterSessionLockFromRoute,
  pinLiveKitPublisherHostBeforeToken,
  pinLiveRoomSession,
} from "@/src/lib/liveRoomSessionGuard";
import { prewarmLiveRoomMediaPermissions } from "@/src/lib/liveRoomStartup";

export {
  resolveLivePreflightRoutePublisher,
  resolveLivePreflightRouteNeedsMic,
  resolveLivePreflightRouteNeedsCamera,
  resolveLivePreflightModeFromRoute,
  type LivePreflightMode,
} from "@/src/lib/livePreflightMode";

const SILENT_PREFLIGHT_TIMEOUT_MS = 4000;
const SILENT_TOKEN_RACE_MS = 3500;

export type SilentPreflightStatus = "idle" | "running" | "done" | "failed";

export type SilentPreflightSnapshot = {
  key: string;
  status: SilentPreflightStatus;
  startedAt: number;
  completedAt?: number;
  scheduleReady: boolean;
  tokenReady: boolean;
  permissionsPrewarmed: boolean;
  needsVisibleOverlay: boolean;
  isPublisher: boolean;
  preflightMode: LivePreflightMode;
  viewerOnly: boolean;
  source?: string;
  error?: string;
};

function silentStore(): Record<string, SilentPreflightSnapshot> {
  const g = globalThis as any;
  if (!g.__KRISTO_LIVE_SILENT_PREFLIGHT__) {
    g.__KRISTO_LIVE_SILENT_PREFLIGHT__ = {};
  }
  return g.__KRISTO_LIVE_SILENT_PREFLIGHT__;
}

export function silentPreflightKey(liveBridgeId: string, userId: string) {
  return `${String(liveBridgeId || "").trim()}|${String(userId || "").trim()}`;
}

export function readSilentPreflightSnapshot(
  liveBridgeId: string,
  userId: string
): SilentPreflightSnapshot | null {
  const key = silentPreflightKey(liveBridgeId, userId);
  if (!key || key === "|") return null;
  return silentStore()[key] || null;
}

function writeSilentPreflightSnapshot(snapshot: SilentPreflightSnapshot) {
  silentStore()[snapshot.key] = snapshot;
}

function routeViewerOnly(routeParams: Record<string, unknown>): boolean {
  return resolveLivePreflightModeFromRoute(routeParams).mode === "viewer";
}

/** Fire-and-forget silent preflight before navigating to live-room. */
export function prepareLiveRoomSilentPreflight(input: PrepareLiveRoomSilentPreflightInput) {
  const liveBridgeId = String(input.liveBridgeId || "").trim();
  const userId = String(input.userId || "").trim();
  if (!liveBridgeId || !userId) return;

  const routeParams = input.routeParams || {};
  const modeResolved = resolveLivePreflightModeFromRoute(routeParams, userId);
  const viewerOnly = modeResolved.mode === "viewer";
  const isPublisher = !viewerOnly;
  const key = silentPreflightKey(liveBridgeId, userId);
  const existing = silentStore()[key];
  if (existing?.status === "running") return;

  const startedAt = Date.now();
  const snapshot: SilentPreflightSnapshot = {
    key,
    status: "running",
    startedAt,
    scheduleReady: input.scheduleReady !== false,
    tokenReady: false,
    permissionsPrewarmed: false,
    needsVisibleOverlay: false,
    isPublisher,
    preflightMode: modeResolved.mode,
    viewerOnly,
    source: input.source,
  };
  writeSilentPreflightSnapshot(snapshot);

  logSilentLivePreflightStart({
    liveBridgeId,
    userId,
    source: input.source,
    isPublisher,
    viewerOnly,
    preflightMode: modeResolved.mode,
    scheduleReady: snapshot.scheduleReady,
  });

  void (async () => {
    let tokenReady = false;
    let permissionsPrewarmed = false;
    let error: string | undefined;

    try {
      const identity = String(
        input.identity ||
          routeParams.claimedByUserId ||
          userId
      )
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "");

      const churchId = String(input.churchId || routeParams.churchId || "").trim();
      const headers = getKristoHeaders({
        userId: String(routeParams.claimedByUserId || userId),
        role: "Member",
        churchId,
      }) as Record<string, string>;

      const tokenCanPublish = resolveLivePreflightNeedsMicFromRoute(routeParams);

      const tokenResult = await raceTimeout(
        fetchLiveKitToken({
          roomName: liveBridgeId,
          identity,
          canPublish: tokenCanPublish,
          headers,
          source: `silent-preflight-${input.source}`,
        }),
        SILENT_TOKEN_RACE_MS
      );
      tokenReady = !!tokenResult?.token;

      if (tokenReady) {
        markLiveRoomLiveKitConnecting(liveBridgeId);
      }

      if (modeResolved.needsMic || modeResolved.needsCamera) {
        prewarmLiveRoomMediaPermissions(`silent-preflight-${input.source}`);
        permissionsPrewarmed = true;
      }
    } catch (e: any) {
      error = String(e?.message || e);
    }

    const elapsedMs = Date.now() - startedAt;
    const timedOut = elapsedMs >= SILENT_PREFLIGHT_TIMEOUT_MS;
    const needsVisibleOverlay =
      isPublisher || timedOut || (!tokenReady && !viewerOnly) || !!error;

    const done: SilentPreflightSnapshot = {
      ...snapshot,
      status: error && !tokenReady ? "failed" : "done",
      completedAt: Date.now(),
      tokenReady,
      permissionsPrewarmed,
      needsVisibleOverlay,
      error,
    };
    writeSilentPreflightSnapshot(done);

    logSilentLivePreflightDone({
      liveBridgeId,
      userId,
      source: input.source,
      elapsedMs,
      tokenReady,
      permissionsPrewarmed,
      needsVisibleOverlay,
      isPublisher,
      viewerOnly,
      preflightMode: modeResolved.mode,
      timedOut,
      error,
    });
  })();
}

export function shouldSkipVisiblePreflightOnMount(
  liveBridgeId: string,
  userId: string
): boolean {
  const snap = readSilentPreflightSnapshot(liveBridgeId, userId);
  if (snap?.preflightMode && snap.preflightMode !== "viewer") return false;
  if (snap?.isPublisher) return false;
  return snap?.status === "done" && !snap.needsVisibleOverlay;
}

export function logLivePreflightFastPathIfEligible(
  liveBridgeId: string,
  userId: string,
  source: string
) {
  if (!shouldSkipVisiblePreflightOnMount(liveBridgeId, userId)) return;
  const snap = readSilentPreflightSnapshot(liveBridgeId, userId);
  logLivePreflightFastPathUsed({
    liveBridgeId,
    userId,
    source,
    tokenReady: snap?.tokenReady,
    scheduleReady: snap?.scheduleReady,
    permissionsPrewarmed: snap?.permissionsPrewarmed,
    preflightMode: snap?.preflightMode,
    elapsedMs: snap?.completedAt && snap?.startedAt ? snap.completedAt - snap.startedAt : null,
  });
}

const LIVE_ROOM_PATH = "/(tabs)/more/my-church-room/messages/live-room";

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export type PrepareLiveRoomSilentPreflightInput = {
  liveBridgeId: string;
  userId: string;
  churchId?: string;
  routeParams?: Record<string, unknown>;
  source: string;
  identity?: string;
  scheduleReady?: boolean;
  routeSlotCount?: number;
};

export function pushLiveRoomWithSilentPreflight(input: {
  router: Router;
  params: Record<string, string>;
  viewerUserId: string;
  viewerChurchId?: string;
  source: string;
  routeSlotCount?: number;
  navigationMethod?: "push" | "replace";
}) {
  const viewerUserId = String(input.viewerUserId || "").trim();
  const routeParams = input.params || {};
  const liveBridgeId = String(
    routeParams.liveId || routeParams.feedId || routeParams.localScheduleId || ""
  ).trim();

  prepareLiveRoomSilentPreflight({
    liveBridgeId,
    userId: viewerUserId,
    churchId: input.viewerChurchId || routeParams.churchId,
    routeParams,
    source: input.source,
    routeSlotCount: input.routeSlotCount,
    scheduleReady: true,
  });

  markLiveEnterTap(input.source, { liveBridgeId });

  (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
  (globalThis as any).__KRISTO_LIVE_RING_NAV_AT__ = Date.now();

  if (liveBridgeId && viewerUserId) {
    pinLiveRoomSession({
      liveBridgeId,
      userId: viewerUserId,
      routeSlotCount: Number(input.routeSlotCount || 0),
      source: `silent-preflight-${input.source}`,
    });
    clearStaleLiveEndedFlag(liveBridgeId, "silent-preflight-nav");
  }

  const modeResolved = resolveLivePreflightModeFromRoute(routeParams, viewerUserId);
  const wantsPublish = modeResolved.mode !== "viewer";
  const tokenCanPublish = resolveLivePreflightNeedsMicFromRoute(routeParams);

  if (liveBridgeId && viewerUserId && wantsPublish) {
    pinClaimEnterSessionLockFromRoute({
      liveBridgeId,
      routeParams: routeParams as Record<string, unknown>,
      source: `silent-preflight-${input.source}`,
    });
    pinLiveKitPublisherHostBeforeToken(liveBridgeId, `silent-preflight-${input.source}`, {
      stableIdentity: String(routeParams.claimedByUserId || viewerUserId).replace(
        /[^a-zA-Z0-9_]/g,
        ""
      ),
    });
    const churchId = String(input.viewerChurchId || routeParams.churchId || "").trim();
    const tokenIdentity = String(routeParams.claimedByUserId || viewerUserId).replace(
      /[^a-zA-Z0-9_]/g,
      ""
    );
    prefetchLiveKitToken({
      roomName: liveBridgeId,
      identity: tokenIdentity,
      canPublish: tokenCanPublish,
      source: `silent-preflight-${input.source}`,
      headers: getKristoHeaders({
        userId: String(routeParams.claimedByUserId || viewerUserId),
        role: "Member",
        churchId,
      }) as Record<string, string>,
    });
    if (modeResolved.needsMic || modeResolved.needsCamera) {
      prewarmLiveRoomMediaPermissions(`silent-preflight-${input.source}`);
    }
  } else if (liveBridgeId && viewerUserId) {
    const churchId = String(input.viewerChurchId || routeParams.churchId || "").trim();
    const tokenIdentity = String(viewerUserId).replace(/[^a-zA-Z0-9_]/g, "");
    prefetchLiveKitToken({
      roomName: liveBridgeId,
      identity: tokenIdentity,
      canPublish: false,
      source: `silent-preflight-${input.source}`,
      headers: getKristoHeaders({
        userId: viewerUserId,
        role: "Member",
        churchId,
      }) as Record<string, string>,
    });
  }

  const nav = {
    pathname: LIVE_ROOM_PATH,
    params: routeParams,
  } as any;

  if (input.navigationMethod === "replace") {
    input.router.replace(nav);
  } else {
    input.router.push(nav);
  }
}
