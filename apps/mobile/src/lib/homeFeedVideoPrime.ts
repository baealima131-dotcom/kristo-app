import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { isHomeFeedInlineVideoAutoplayEnabled } from "@/src/lib/homeFeedVideoMode";

/**
 * Decode-prime store for the first Home Feed video.
 *
 * Startup creates + primes ONE player in HomeFeedVideoPrimer (attached
 * VideoView). The first Home Feed row must claim that same instance only after
 * primed=true — never before, or the primer loses its surface mid-decode.
 */

const PRIME_TTL_MS = 120_000;
const FIRST_FRAME_TIME = 0.03;

/** Low-latency progressive streaming — mirror of the React player options. */
const PROGRESSIVE_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 4,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.5,
  prioritizeTimeOverSizeThreshold: true,
} as const;

type PrimeState = {
  url: string;
  rawUrl: string;
  player: VideoPlayer | null;
  primed: boolean;
  adopted: boolean;
  createdAt: number;
};

/** Set when prepareFirstHomeFeedVideo reports firstFramePrimed=true. */
type StartupFirstVideoTarget = {
  rowId: string;
  url: string;
  rawUrl: string;
  firstFramePrimed: boolean;
};

/** Held across React strict-mode remounts so we don't release + re-decode. */
type HeldStartupPlayer = {
  rowId: string;
  url: string;
  player: VideoPlayer;
};

let state: PrimeState | null = null;
let startupTarget: StartupFirstVideoTarget | null = null;
let heldStartupPlayer: HeldStartupPlayer | null = null;
const listeners = new Set<() => void>();
let primedResolvers: Array<(ok: boolean) => void> = [];
let ttlTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeUrl(url: string): string {
  return String(url || "").trim().split("?")[0];
}

function isNetworkUrl(url: string): boolean {
  const trimmed = String(url || "").trim();
  return Boolean(trimmed) && /^https?:\/\//i.test(trimmed);
}

function safeRelease(player: VideoPlayer | null | undefined) {
  if (!player) return;
  try {
    player.pause();
  } catch {}
  try {
    player.release();
  } catch {}
}

function playerCurrentTime(player: VideoPlayer): number {
  try {
    return Number((player as any).currentTime) || 0;
  } catch {
    return 0;
  }
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function resolvePending(ok: boolean) {
  const resolvers = primedResolvers;
  primedResolvers = [];
  resolvers.forEach((resolve) => {
    try {
      resolve(ok);
    } catch {}
  });
}

function clearTtl() {
  if (ttlTimer) {
    clearTimeout(ttlTimer);
    ttlTimer = null;
  }
}

function scheduleTtl() {
  clearTtl();
  ttlTimer = setTimeout(() => {
    if (state && !state.adopted) {
      console.log("KRISTO_VIDEO_PRIME_RELEASED", { url: state.url, reason: "ttl" });
      teardownState();
      notify();
    }
  }, PRIME_TTL_MS);
}

function teardownState() {
  clearTtl();
  if (state && state.player && !state.adopted) {
    safeRelease(state.player);
  }
  state = null;
  resolvePending(false);
}

function matchesStartupTarget(rawUrl: string, postId: string): boolean {
  if (!startupTarget) return false;
  const url = normalizeUrl(rawUrl);
  const id = String(postId || "").trim();
  return url === startupTarget.url && id === startupTarget.rowId;
}

function takeParkedPlayer(requirePrimed: boolean): VideoPlayer | null {
  if (!state || !state.player || state.adopted) return null;
  if (requirePrimed && !state.primed) return null;

  const player = state.player;
  const wasPrimed = state.primed;
  const url = state.url;

  state.adopted = true;
  state.player = null;
  clearTtl();
  console.log("KRISTO_VIDEO_PRIME_ADOPTED", { url, primed: wasPrimed });
  state = null;
  resolvePending(true);
  queueMicrotask(notify);
  return player;
}

// ---------------------------------------------------------------------------
// Startup prepare → marks the row/url the feed must reuse.
// ---------------------------------------------------------------------------

export function markStartupFirstVideoPrepared(
  rowId: string,
  rawUrl: string,
  firstFramePrimed: boolean
) {
  if (!isHomeFeedInlineVideoAutoplayEnabled()) return;
  const url = normalizeUrl(rawUrl);
  const id = String(rowId || "").trim();
  if (!id || !url) return;
  const nextPrimed = Boolean(firstFramePrimed);
  const changed =
    !startupTarget ||
    startupTarget.rowId !== id ||
    startupTarget.url !== url ||
    startupTarget.firstFramePrimed !== nextPrimed;
  startupTarget = {
    rowId: id,
    url,
    rawUrl: String(rawUrl || "").trim(),
    firstFramePrimed: nextPrimed,
  };
  if (changed) notify();
}

/** Sync registration when display rows are built — before the feed player mounts. */
export function tryRegisterStartupFirstVideoTarget(rowId: string, rawUrl: string): void {
  if (!isHomeFeedInlineVideoAutoplayEnabled()) return;
  const url = normalizeUrl(rawUrl);
  const id = String(rowId || "").trim();
  if (!id || !url) return;
  if (startupTarget?.rowId === id && startupTarget.url === url) return;
  markStartupFirstVideoPrepared(rowId, rawUrl, false);
}

export function isStartupFirstVideoTarget(rawUrl: string, postId: string): boolean {
  return matchesStartupTarget(rawUrl, postId);
}

export function isStartupVideoPendingAdoption(rawUrl: string, postId: string): boolean {
  if (!matchesStartupTarget(rawUrl, postId)) return false;
  return Boolean(state && state.url === normalizeUrl(rawUrl) && !state.adopted && !state.primed);
}

export function isStartupVideoReadyForAdoption(rawUrl: string, postId: string): boolean {
  if (!matchesStartupTarget(rawUrl, postId)) return false;
  const url = normalizeUrl(rawUrl);
  return Boolean(state && state.url === url && state.player && state.primed && !state.adopted);
}

/**
 * Claim the startup-primed player for the first feed video row.
 * Returns null while priming is still in flight (subscribe + retry).
 * Logs KRISTO_STARTUP_VIDEO_REUSED or KRISTO_STARTUP_VIDEO_REUSE_FAILED.
 */
export function claimStartupVideoPlayer(rawUrl: string, postId: string): VideoPlayer | null {
  const url = normalizeUrl(rawUrl);
  const id = String(postId || "").trim();

  if (!matchesStartupTarget(rawUrl, postId)) {
    return null;
  }

  // Strict-mode remount: reuse the held instance, no second player.
  if (heldStartupPlayer && heldStartupPlayer.url === url && heldStartupPlayer.rowId === id) {
    const player = heldStartupPlayer.player;
    heldStartupPlayer = null;
    console.log("KRISTO_STARTUP_VIDEO_REUSED", {
      postId: id,
      url,
      primed: playerCurrentTime(player) > FIRST_FRAME_TIME,
      reason: "reattach-after-remount",
    });
    return player;
  }

  if (!state || state.url !== url || !state.player) {
    return null;
  }

  if (!state.primed) {
    return null;
  }

  const player = takeParkedPlayer(true);
  if (!player) {
    console.log("KRISTO_STARTUP_VIDEO_REUSE_FAILED", {
      postId: id,
      url,
      reason: "take-parked-failed",
    });
    return null;
  }

  console.log("KRISTO_STARTUP_VIDEO_REUSED", {
    postId: id,
    url,
    primed: true,
    currentTime: playerCurrentTime(player),
    reason: "startup-primed",
  });
  return player;
}

/** Keep startup player alive across brief unmount/remount (strict mode, row recycle). */
export function holdStartupVideoPlayerForRemount(
  rawUrl: string,
  postId: string,
  player: VideoPlayer
): void {
  if (!matchesStartupTarget(rawUrl, postId)) {
    safeRelease(player);
    return;
  }
  heldStartupPlayer = {
    rowId: String(postId || "").trim(),
    url: normalizeUrl(rawUrl),
    player,
  };
}

// ---------------------------------------------------------------------------
// Prime request (hidden VideoView).
// ---------------------------------------------------------------------------

export async function requestHomeFeedVideoPrime(rawUrl: string): Promise<boolean> {
  if (!isHomeFeedInlineVideoAutoplayEnabled()) return false;
  const url = normalizeUrl(rawUrl);
  if (!url || !isNetworkUrl(rawUrl)) return Promise.resolve(false);

  if (state && state.url === url) {
    if (state.primed) return Promise.resolve(true);
    if (state.adopted) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => primedResolvers.push(resolve));
  }

  if (state) {
    console.log("KRISTO_VIDEO_PRIME_RELEASED", { url: state.url, reason: "new-request" });
    teardownState();
  }

  let player: VideoPlayer | null = null;
  try {
    player = createVideoPlayer({ uri: rawUrl, contentType: "progressive" as const });
    player.loop = true;
    player.muted = true;
    try {
      player.bufferOptions = { ...PROGRESSIVE_BUFFER_OPTIONS };
    } catch {}
  } catch {
    safeRelease(player);
    return Promise.resolve(false);
  }

  state = {
    url,
    rawUrl: String(rawUrl || "").trim(),
    player,
    primed: false,
    adopted: false,
    createdAt: Date.now(),
  };
  scheduleTtl();
  console.log("KRISTO_VIDEO_PRIME_REQUESTED", { url });
  notify();

  return new Promise<boolean>((resolve) => primedResolvers.push(resolve));
}

// ---------------------------------------------------------------------------
// Primer component bridge.
// ---------------------------------------------------------------------------

export type HomeFeedVideoPrimeSnapshot = {
  url: string;
  rawUrl: string;
  player: VideoPlayer;
  primed: boolean;
} | null;

export function getHomeFeedVideoPrimeSnapshot(): HomeFeedVideoPrimeSnapshot {
  if (!state || !state.player || state.adopted) return null;
  return {
    url: state.url,
    rawUrl: state.rawUrl,
    player: state.player,
    primed: state.primed,
  };
}

export function subscribeHomeFeedVideoPrime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markHomeFeedVideoPrimed(rawUrl: string): void {
  const url = normalizeUrl(rawUrl);
  if (!state || state.url !== url || state.primed) return;
  state.primed = true;
  console.log("KRISTO_VIDEO_PRIME_READY", { url, attached: true });
  resolvePending(true);
  notify();
}

export function markHomeFeedVideoPrimeFailed(rawUrl: string, reason: string): void {
  const url = normalizeUrl(rawUrl);
  if (!state || state.url !== url) return;
  console.log("KRISTO_VIDEO_PRIME_FAILED", { url, reason });
  teardownState();
  notify();
}

// ---------------------------------------------------------------------------
// Legacy adoption API — requires primed unless explicitly relaxed.
// ---------------------------------------------------------------------------

export function hasPrimedHomeFeedPlayer(rawUrl: string): boolean {
  const url = normalizeUrl(rawUrl);
  return Boolean(state && state.url === url && state.player && state.primed && !state.adopted);
}

/** @deprecated Prefer claimStartupVideoPlayer for the first feed video row. */
export function adoptPrimedHomeFeedPlayer(rawUrl: string): VideoPlayer | null {
  const url = normalizeUrl(rawUrl);
  if (!state || state.url !== url) return null;
  return takeParkedPlayer(true);
}

export function releasePrimedHomeFeedPlayer(rawUrl: string): void {
  const url = normalizeUrl(rawUrl);
  if (!state || state.url !== url) return;
  console.log("KRISTO_VIDEO_PRIME_RELEASED", { url, reason: "manual" });
  teardownState();
  notify();
}

export function __resetHomeFeedVideoPrimeForTest(): void {
  teardownState();
  startupTarget = null;
  if (heldStartupPlayer) {
    safeRelease(heldStartupPlayer.player);
    heldStartupPlayer = null;
  }
  listeners.clear();
}
