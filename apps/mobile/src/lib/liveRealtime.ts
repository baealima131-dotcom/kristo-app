import { AppState, Image, type AppStateStatus } from "react-native";

import { apiGet } from "@/src/lib/kristoApi";
import { loadProfileDraft } from "@/src/lib/profileStore";
import { logTrafficPollingPaused, requestKey, shouldThrottleFetch } from "@/src/lib/kristoTraffic";

export type LightLivePayload = {
  removedFromLive?: boolean;
  isLive?: boolean;
  liveId?: string;
  requestPolicy?: string;
  requests?: Record<string, any>;
  viewerPresence?: Record<string, any>;
  viewerCount?: number;
  actualChurchPastorUserId?: string;
  raw?: any;
  routeFailed?: boolean;
  /** True only when backend returned an ended live object — never for null/missing bridge. */
  explicitlyEnded?: boolean;
  /** GET returned 200 with live:null — no bridge session row yet, not schedule ended. */
  noBridgeSession?: boolean;
  endpointStatus?: number | null;
};

const preservedChurchLiveById = new Map<string, any>();

const profileAvatarCache = new Map<string, { uri: string; at: number }>();
const participantCache = new Map<string, { data: any; at: number }>();

const LIVE_AVATAR_TTL_MS = 10 * 60 * 1000;
const PARTICIPANT_TTL_MS = 5 * 60 * 1000;

export function logLiveTraffic(event: string, detail?: Record<string, unknown>) {
  console.log(`[LiveRealtime] ${event}`, detail || {});
}

export function shallowJsonEqual(a: unknown, b: unknown) {
  if (a === b) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

export function isChurchLiveRouteFailure(res: any | null | undefined): boolean {
  if (!res) return true;
  if (res.ok === false) return true;
  const status = Number(res.status || 0);
  if (status === 404 || status >= 500) return true;
  if (String(res.reason || "").trim() === "network_error") return true;
  return false;
}

export function rememberPreservedChurchLive(churchId: string, live: any | null | undefined) {
  const cid = String(churchId || live?.churchId || "").trim();
  if (!cid || !live || live.isLive !== true || live.endedAt) return;
  preservedChurchLiveById.set(cid, live);
}

export function readPreservedChurchLive(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  return preservedChurchLiveById.get(cid) || null;
}

export function clearPreservedChurchLive(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return;
  preservedChurchLiveById.delete(cid);
}

export function extractLightLivePayload(res: any): LightLivePayload {
  const endpointStatus =
    typeof res?.status === "number"
      ? res.status
      : res?.ok === false
        ? Number(res?.status || 0) || null
        : 200;

  if (isChurchLiveRouteFailure(res)) {
    return {
      routeFailed: true,
      endpointStatus,
      isLive: undefined,
    };
  }

  if (res?.removedFromLive === true) {
    return {
      removedFromLive: true,
      explicitlyEnded: true,
      isLive: false,
      endpointStatus,
    };
  }

  const live = res?.live || null;
  if (!live) {
    return {
      isLive: false,
      noBridgeSession: true,
      explicitlyEnded: false,
      endpointStatus,
    };
  }

  const isActive = live.isLive === true && !live.endedAt;
  const hasEndedAt = Boolean(live.endedAt);
  return {
    isLive: isActive,
    explicitlyEnded: !isActive && hasEndedAt,
    noBridgeSession: false,
    liveId: String(live.liveId || ""),
    requestPolicy: String(live.requestPolicy || ""),
    requests: live.requests && typeof live.requests === "object" ? live.requests : undefined,
    viewerPresence:
      live.viewerPresence && typeof live.viewerPresence === "object" ? live.viewerPresence : undefined,
    viewerCount: Number(live.viewerCount || 0),
    actualChurchPastorUserId: String(live.actualChurchPastorUserId || ""),
    raw: live,
    endpointStatus,
  };
}

export type ChurchLiveStateUpdate = {
  nextLive: any | null;
  shouldUpdate: boolean;
  preserved: boolean;
  source: string;
};

export function resolveChurchLiveStateUpdate(input: {
  patch: LightLivePayload;
  previousLive: any | null;
  churchId?: string;
  /** Feed/schedule ring reports a slot in its live window right now. */
  scheduleLiveActive?: boolean;
  /** Schedule feed was explicitly ended/deleted on backend. */
  scheduleExplicitlyEnded?: boolean;
}): ChurchLiveStateUpdate {
  const churchId = String(input.churchId || input.previousLive?.churchId || "").trim();
  const scheduleLiveActive = input.scheduleLiveActive === true;
  const preservedFallback =
    input.previousLive || (churchId ? readPreservedChurchLive(churchId) : null);

  if (input.patch.routeFailed) {
    return {
      nextLive: preservedFallback,
      shouldUpdate: false,
      preserved: true,
      source: preservedFallback ? "route_failed_preserved_previous" : "route_failed_no_previous",
    };
  }

  if (input.patch.removedFromLive) {
    if (churchId) clearPreservedChurchLive(churchId);
    return {
      nextLive: null,
      shouldUpdate: true,
      preserved: false,
      source: "backend_removed_from_live",
    };
  }

  if (input.scheduleExplicitlyEnded && (input.patch.explicitlyEnded || input.patch.noBridgeSession)) {
    if (churchId) clearPreservedChurchLive(churchId);
    return {
      nextLive: null,
      shouldUpdate: true,
      preserved: false,
      source: "schedule_explicitly_ended",
    };
  }

  if (input.patch.explicitlyEnded) {
    if (scheduleLiveActive) {
      console.log("KRISTO_LIVE_NULL_PRESERVED_BY_ACTIVE_SCHEDULE", {
        churchId,
        reason: "explicitly_ended_signal_while_schedule_live",
        hadPreviousLive: Boolean(preservedFallback?.isLive),
      });
      return {
        nextLive: preservedFallback,
        shouldUpdate: false,
        preserved: true,
        source: "schedule_live_preserved_over_ended_signal",
      };
    }
    if (churchId) clearPreservedChurchLive(churchId);
    return {
      nextLive: null,
      shouldUpdate: true,
      preserved: false,
      source: "backend_explicit_ended",
    };
  }

  if (input.patch.isLive === true && input.patch.raw && !input.patch.raw?.endedAt) {
    if (churchId) rememberPreservedChurchLive(churchId, input.patch.raw);
    return {
      nextLive: input.patch.raw,
      shouldUpdate: true,
      preserved: false,
      source: "backend_live_active",
    };
  }

  if (input.patch.noBridgeSession || input.patch.isLive === false) {
    if (scheduleLiveActive) {
      console.log("KRISTO_LIVE_NULL_PRESERVED_BY_ACTIVE_SCHEDULE", {
        churchId,
        reason: "no_bridge_session_while_schedule_live",
        hadPreviousLive: Boolean(preservedFallback?.isLive),
        noBridgeSession: input.patch.noBridgeSession === true,
      });
      return {
        nextLive: preservedFallback,
        shouldUpdate: false,
        preserved: true,
        source: "no_bridge_session_schedule_active",
      };
    }

    if (preservedFallback) {
      return {
        nextLive: preservedFallback,
        shouldUpdate: false,
        preserved: true,
        source: "no_bridge_session_preserved",
      };
    }

    return {
      nextLive: null,
      shouldUpdate: false,
      preserved: false,
      source: "no_bridge_session_no_previous",
    };
  }

  return {
    nextLive: input.previousLive,
    shouldUpdate: false,
    preserved: Boolean(input.previousLive),
    source: "unchanged",
  };
}

export function paginateMessages<T>(items: T[] | undefined, limit = 80, offsetFromEnd = 0): T[] {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length <= limit) return arr;
  const end = Math.max(limit, arr.length - offsetFromEnd);
  return arr.slice(Math.max(0, end - limit), end);
}

/** Compact signature for message list equality — skips redundant store/UI updates. */
export function messagesListSignature(items: Array<{ id?: string; createdAt?: number }> | undefined) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return "0";
  const first = arr[0];
  const last = arr[arr.length - 1];
  return `${arr.length}:${String(first?.id || "")}:${Number(first?.createdAt || 0)}:${String(last?.id || "")}:${Number(last?.createdAt || 0)}`;
}

const preloadedImages = new Set<string>();

/** Prefetch remote avatars/attachments once per session. */
export function preloadLiveImages(uris: string[] | undefined, max = 16) {
  const unique = [...new Set((uris || []).map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(
    0,
    max
  );
  for (const uri of unique) {
    if (preloadedImages.has(uri)) continue;
    preloadedImages.add(uri);
    void Image.prefetch(uri).catch(() => {
      preloadedImages.delete(uri);
    });
  }
}

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounce typing pulses so draft keystrokes do not spam presence/network. */
export function pulseTypingIndicator(key: string, onPulse: () => void, ms = 2800) {
  const k = String(key || "default");
  const prev = typingTimers.get(k);
  if (prev) clearTimeout(prev);
  onPulse();
  typingTimers.set(
    k,
    setTimeout(() => {
      typingTimers.delete(k);
    }, ms)
  );
}

const readOnceKeys = new Set<string>();

/** Fire read-receipt handler at most once per thread per app session. */
export function markThreadReadOnce(threadId: string, onRead: () => void) {
  const id = String(threadId || "").trim();
  if (!id || readOnceKeys.has(id)) return;
  readOnceKeys.add(id);
  onRead();
}

export async function resolveCachedLiveAvatar(userId?: string, sessionAvatar?: string) {
  const id = String(userId || "").trim();
  const cached = id ? profileAvatarCache.get(id) : null;
  if (cached && Date.now() - cached.at < LIVE_AVATAR_TTL_MS) {
    logLiveTraffic("avatar cache hit", { userId: id });
    return cached.uri;
  }

  const draft = id ? await loadProfileDraft(id) : null;
  const fromDraft = String(draft?.avatarUri || "").trim();
  const fromSession = String(sessionAvatar || "").trim();
  const uri = fromDraft || fromSession;
  if (uri && id) {
    profileAvatarCache.set(id, { uri, at: Date.now() });
    logLiveTraffic("avatar cache miss", { userId: id, source: fromDraft ? "draft" : "session" });
  }
  return uri;
}

export function getCachedParticipant(key: string) {
  const row = participantCache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > PARTICIPANT_TTL_MS) {
    participantCache.delete(key);
    return null;
  }
  return row.data;
}

export function setCachedParticipant(key: string, data: any) {
  participantCache.set(key, { data, at: Date.now() });
}

export function invalidateCachedParticipant(key: string) {
  participantCache.delete(key);
}

const churchLiveRouteResponseLogSigByKey = new Map<string, string>();

export async function fetchLightLiveState(
  headers: Record<string, string>,
  screen = "LiveRoom",
  liveId?: string,
  opts?: { force?: boolean }
): Promise<LightLivePayload> {
  const userId = String(headers["x-kristo-user-id"] || "").trim();
  const liveIdParam = String(liveId || "").trim();
  const path = liveIdParam
    ? `/api/church/live?lite=1&liveId=${encodeURIComponent(liveIdParam)}`
    : "/api/church/live?lite=1";
  const key = requestKey("GET", path, userId);
  if (!opts?.force && shouldThrottleFetch(key, 2500)) {
    logLiveTraffic("duplicate live sync prevented", { screen, liveId: liveIdParam || null });
    return {};
  }

  const res: any = await apiGet(path, { headers: headers as any }, { screen, throttleMs: opts?.force ? 0 : 2500 });
  const patch = extractLightLivePayload(res);
  const churchId = String(headers["x-kristo-church-id"] || headers["X-Kristo-Church-Id"] || "").trim();

  const routeLogSig = [
    path,
    churchId,
    userId,
    patch.endpointStatus ?? "",
    patch.routeFailed === true,
    patch.isLive ?? "",
    patch.explicitlyEnded === true,
    patch.noBridgeSession === true,
    patch.liveId || patch.raw?.liveId || "",
  ].join("|");
  if (churchLiveRouteResponseLogSigByKey.get(key) !== routeLogSig) {
    churchLiveRouteResponseLogSigByKey.set(key, routeLogSig);
    console.log("KRISTO_CHURCH_LIVE_ROUTE_RESPONSE", {
      endpoint: path,
      churchId,
      appUserId: userId,
      endpointStatus: patch.endpointStatus ?? null,
      routeFailed: patch.routeFailed === true,
      isLive: patch.isLive ?? null,
      explicitlyEnded: patch.explicitlyEnded === true,
      noBridgeSession: patch.noBridgeSession === true,
      liveId: patch.liveId || patch.raw?.liveId || null,
    });
  }

  if (patch.isLive === true && patch.raw) {
    rememberPreservedChurchLive(churchId, patch.raw);
  }

  return patch;
}

type AdaptiveOpts = {
  screen: string;
  enabled?: boolean;
  activeMs?: number;
  idleMs?: number;
  isActive?: () => boolean;
  onTick: (reason: "mount" | "poll" | "foreground") => void | Promise<void>;
};

/** Adaptive polling loop — pauses in background, slows when idle. */
export function startAdaptiveLivePolling(opts: AdaptiveOpts) {
  const screen = opts.screen;
  const enabled = opts.enabled !== false;
  const activeMs = opts.activeMs ?? 6000;
  const idleMs = opts.idleMs ?? 24000;
  const isActive = opts.isActive ?? (() => true);

  if (!enabled) {
    logTrafficPollingPaused(screen, "disabled");
    return () => {};
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let appState: AppStateStatus = AppState.currentState;

  const canRun = () => !cancelled && appState === "active";

  const clear = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const scheduleNext = (reason: "mount" | "poll" | "foreground") => {
    clear();
    if (!canRun()) {
      logTrafficPollingPaused(screen, appState !== "active" ? "background" : "stopped");
      return;
    }
    const delay = reason === "mount" ? 0 : isActive() ? activeMs : idleMs;
    timer = setTimeout(async () => {
      if (!canRun()) return;
      try {
        await opts.onTick(reason === "mount" ? "mount" : reason === "foreground" ? "foreground" : "poll");
      } catch {}
      scheduleNext("poll");
    }, delay);
  };

  scheduleNext("mount");

  const sub = AppState.addEventListener("change", (next) => {
    appState = next;
    if (next === "active") {
      scheduleNext("foreground");
    } else {
      clear();
      logTrafficPollingPaused(screen, "background");
    }
  });

  return () => {
    cancelled = true;
    clear();
    sub.remove();
    logTrafficPollingPaused(screen, "unmounted");
  };
}

export type RoomMessagesPollOpts = {
  roomId: string;
  enabled?: boolean;
  intervalMs?: number;
  onTick: () => void | Promise<boolean | void>;
};

/** Fast silent polling for active message rooms — ~1–2s cross-device delivery. */
export function startRoomMessagesPolling(opts: RoomMessagesPollOpts) {
  const roomId = String(opts.roomId || "").trim();
  const enabled = opts.enabled !== false;
  const intervalMs = opts.intervalMs ?? 1500;

  if (!enabled || !roomId) {
    return () => {};
  }

  let cancelled = false;
  let inflight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let appState: AppStateStatus = AppState.currentState;

  const canRun = () => !cancelled && appState === "active";

  const clear = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const runTick = async () => {
    if (!canRun()) return;
    if (inflight) {
      console.log("[RoomMessagesPoll] skip-inflight", { roomId });
      return;
    }

    console.log("[RoomMessagesPoll] tick", { roomId });
    inflight = true;
    try {
      const updated = await opts.onTick();
      if (updated === true) {
        console.log("[RoomMessagesPoll] updated", { roomId });
      }
    } catch {
      // silent — delivery poll should not surface errors in UI
    } finally {
      inflight = false;
    }
  };

  const scheduleNext = () => {
    clear();
    if (!canRun()) return;
    timer = setTimeout(async () => {
      await runTick();
      scheduleNext();
    }, intervalMs);
  };

  console.log("[RoomMessagesPoll] start", { roomId, intervalMs });
  scheduleNext();

  const sub = AppState.addEventListener("change", (next) => {
    appState = next;
    if (next === "active") {
      void runTick();
      scheduleNext();
    } else {
      clear();
    }
  });

  return () => {
    cancelled = true;
    clear();
    sub.remove();
    console.log("[RoomMessagesPoll] stop", { roomId });
  };
}

export type McHostsPollOpts = {
  assignmentId: string;
  enabled?: boolean;
  intervalMs?: number;
  onTick: () => void | Promise<boolean | void>;
};

/** Fast polling for MC+ host list while ministry / live-control thread is focused. */
export function startMcHostsPolling(opts: McHostsPollOpts) {
  const assignmentId = String(opts.assignmentId || "").trim();
  const enabled = opts.enabled !== false;
  const intervalMs = opts.intervalMs ?? 2500;

  if (!enabled || !assignmentId) {
    return () => {};
  }

  let cancelled = false;
  let inflight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let appState: AppStateStatus = AppState.currentState;

  const canRun = () => !cancelled && appState === "active";

  const clear = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const runTick = async () => {
    if (!canRun()) return;
    if (inflight) return;

    inflight = true;
    try {
      const updated = await opts.onTick();
      if (updated === true) {
        console.log("[McHostsPoll] updated", { assignmentId });
      }
    } catch {
      // silent poll
    } finally {
      inflight = false;
    }
  };

  const scheduleNext = () => {
    clear();
    if (!canRun()) return;
    timer = setTimeout(async () => {
      await runTick();
      scheduleNext();
    }, intervalMs);
  };

  console.log("[McHostsPoll] start", { assignmentId, intervalMs });
  scheduleNext();

  const sub = AppState.addEventListener("change", (next) => {
    appState = next;
    if (next === "active") {
      void runTick();
      scheduleNext();
    } else {
      clear();
    }
  });

  return () => {
    cancelled = true;
    clear();
    sub.remove();
    console.log("[McHostsPoll] stop", { assignmentId });
  };
}
