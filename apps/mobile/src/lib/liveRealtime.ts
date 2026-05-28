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
};

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

export function extractLightLivePayload(res: any): LightLivePayload {
  if (res?.removedFromLive === true) {
    return { removedFromLive: true };
  }

  const live = res?.live || null;
  if (!live) return { isLive: false };

  return {
    isLive: live.isLive === true && !live.endedAt,
    liveId: String(live.liveId || ""),
    requestPolicy: String(live.requestPolicy || ""),
    requests: live.requests && typeof live.requests === "object" ? live.requests : undefined,
    viewerPresence:
      live.viewerPresence && typeof live.viewerPresence === "object" ? live.viewerPresence : undefined,
    viewerCount: Number(live.viewerCount || 0),
    actualChurchPastorUserId: String(live.actualChurchPastorUserId || ""),
    raw: live,
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

export async function fetchLightLiveState(
  headers: Record<string, string>,
  screen = "LiveRoom"
): Promise<LightLivePayload> {
  const userId = String(headers["x-kristo-user-id"] || "").trim();
  const key = requestKey("GET", "/api/church/live?lite=1", userId);
  if (shouldThrottleFetch(key, 2500)) {
    logLiveTraffic("duplicate live sync prevented", { screen });
    return {};
  }

  const res: any = await apiGet("/api/church/live?lite=1", { headers: headers as any }, { screen, throttleMs: 2500 });
  return extractLightLivePayload(res);
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
