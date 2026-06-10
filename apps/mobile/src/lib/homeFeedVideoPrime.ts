import { createVideoPlayer, type VideoPlayer } from "expo-video";

/**
 * Decode-prime cache for Home Feed videos.
 *
 * The point of this module is the difference between "bytes are on disk" and
 * "a frame is decoded and ready to paint". A network range fetch only warms the
 * HTTP layer; AVPlayer still has to parse the moov atom and decode the first GOP
 * before anything appears on screen — that decode is what takes seconds.
 *
 * Here we build the *actual* `expo-video` player while the app is still opening,
 * play it muted until the first frame is decoded (currentTime advances past the
 * first-frame threshold), then immediately pause it at that frame. The primed
 * player is parked in a small cache keyed by playback URL.
 *
 * When the Home Feed mounts the row for that URL, `HomeFeedVideoPlayer` *adopts*
 * the parked player instead of creating a fresh one, so the very first frame is
 * already decoded and playback resumes instantly.
 *
 * Players created with `createVideoPlayer` do NOT auto-release, so ownership is
 * explicit: whoever adopts a player owns its `release()`. Anything left parked
 * is released by the TTL/size sweep below.
 */

/** Matches HomeFeedVideoPlayer.hasPaintedFrame — a real, painted frame. */
const FIRST_FRAME_TIME = 0.03;

/** Decode can legitimately take many seconds on a cold moov-at-end file. */
const PRIME_FIRST_FRAME_TIMEOUT_MS = 30_000;

/** How often we poll currentTime while waiting for the first frame. */
const PRIME_POLL_MS = 100;

/** Park at most this many primed players (first video + a small safety margin). */
const MAX_PRIMED_PLAYERS = 2;

/** Release a parked-but-never-adopted player after this long. */
const PRIME_TTL_MS = 120_000;

/** Low-latency progressive streaming — mirror of the React player options. */
const PROGRESSIVE_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 4,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.5,
  prioritizeTimeOverSizeThreshold: true,
} as const;

type PrimedEntry = {
  url: string;
  player: VideoPlayer;
  primedAt: number;
};

const primedByUrl = new Map<string, PrimedEntry>();
const inflightByUrl = new Map<string, Promise<VideoPlayer | null>>();

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

/** Release anything stale or beyond the cache cap (oldest first). */
function sweepPrimedCache() {
  const now = Date.now();

  for (const [url, entry] of [...primedByUrl.entries()]) {
    if (now - entry.primedAt > PRIME_TTL_MS) {
      primedByUrl.delete(url);
      safeRelease(entry.player);
      console.log("KRISTO_VIDEO_PRIME_RELEASED", { url, reason: "ttl" });
    }
  }

  while (primedByUrl.size > MAX_PRIMED_PLAYERS) {
    let oldestUrl = "";
    let oldestAt = Infinity;
    for (const [url, entry] of primedByUrl.entries()) {
      if (entry.primedAt < oldestAt) {
        oldestAt = entry.primedAt;
        oldestUrl = url;
      }
    }
    if (!oldestUrl) break;
    const entry = primedByUrl.get(oldestUrl);
    primedByUrl.delete(oldestUrl);
    safeRelease(entry?.player);
    console.log("KRISTO_VIDEO_PRIME_RELEASED", { url: oldestUrl, reason: "cap" });
  }
}

/**
 * Play `player` muted until the first frame is decoded (or we time out), then
 * leave it paused exactly at that frame. Resolves true when a frame was painted.
 */
function decodePrimeToFirstFrame(player: VideoPlayer): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let statusSub: { remove: () => void } | null = null;

    const finish = (painted: boolean) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      if (timeout) clearTimeout(timeout);
      try {
        statusSub?.remove();
      } catch {}
      // Always end paused at the painted frame: a primed player must never keep
      // running in the background.
      try {
        player.pause();
      } catch {}
      resolve(painted);
    };

    try {
      statusSub = player.addListener("statusChange", ({ status }) => {
        if (status === "error") finish(false);
      });
    } catch {}

    try {
      player.muted = true;
      player.play();
    } catch {
      finish(false);
      return;
    }

    poll = setInterval(() => {
      let t = 0;
      try {
        t = Number((player as any).currentTime) || 0;
      } catch {}
      if (t > FIRST_FRAME_TIME) {
        finish(true);
      }
    }, PRIME_POLL_MS);

    timeout = setTimeout(() => finish(false), PRIME_FIRST_FRAME_TIMEOUT_MS);
  });
}

/**
 * Build + decode-prime the real player for `url` and park it for adoption.
 * Idempotent per URL: concurrent/repeat calls share one in-flight prime and one
 * parked player. Returns the parked player, or null if priming failed.
 */
export async function primeHomeFeedVideoPlayer(url: string): Promise<VideoPlayer | null> {
  const key = normalizeUrl(url);
  if (!key || !isNetworkUrl(url)) return null;

  const existing = primedByUrl.get(key);
  if (existing) return existing.player;

  const inflight = inflightByUrl.get(key);
  if (inflight) return inflight;

  const job = (async (): Promise<VideoPlayer | null> => {
    let player: VideoPlayer | null = null;
    try {
      player = createVideoPlayer({ uri: url, contentType: "progressive" as const });
      player.loop = true;
      player.muted = true;
      try {
        player.bufferOptions = { ...PROGRESSIVE_BUFFER_OPTIONS };
      } catch {}

      console.log("KRISTO_VIDEO_PRIME_STARTED", { url: key });
      const painted = await decodePrimeToFirstFrame(player);

      if (!painted) {
        safeRelease(player);
        console.log("KRISTO_VIDEO_PRIME_FAILED", { url: key, reason: "no-first-frame" });
        return null;
      }

      primedByUrl.set(key, { url: key, player, primedAt: Date.now() });
      sweepPrimedCache();
      console.log("KRISTO_VIDEO_PRIME_READY", { url: key });
      return player;
    } catch {
      safeRelease(player);
      console.log("KRISTO_VIDEO_PRIME_FAILED", { url: key, reason: "exception" });
      return null;
    }
  })();

  inflightByUrl.set(key, job);
  void job.finally(() => inflightByUrl.delete(key));
  return job;
}

/** True when a fully decode-primed player is parked for this URL. */
export function hasPrimedHomeFeedPlayer(url: string): boolean {
  return primedByUrl.has(normalizeUrl(url));
}

/**
 * Hand the parked player for `url` to the caller, transferring release
 * ownership. Returns null when nothing is parked. After adoption the cache no
 * longer tracks the player — the adopter must `release()` it on unmount.
 */
export function adoptPrimedHomeFeedPlayer(url: string): VideoPlayer | null {
  const key = normalizeUrl(url);
  const entry = primedByUrl.get(key);
  if (!entry) return null;
  primedByUrl.delete(key);
  console.log("KRISTO_VIDEO_PRIME_ADOPTED", { url: key });
  return entry.player;
}

/** Release a parked player without adopting it (e.g. its row will never mount). */
export function releasePrimedHomeFeedPlayer(url: string): void {
  const key = normalizeUrl(url);
  const entry = primedByUrl.get(key);
  if (!entry) return;
  primedByUrl.delete(key);
  safeRelease(entry.player);
  console.log("KRISTO_VIDEO_PRIME_RELEASED", { url: key, reason: "manual" });
}

/** Test/diagnostic reset. */
export function __resetHomeFeedVideoPrimeForTest(): void {
  for (const entry of primedByUrl.values()) safeRelease(entry.player);
  primedByUrl.clear();
  inflightByUrl.clear();
}
