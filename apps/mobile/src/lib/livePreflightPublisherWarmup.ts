import { createLocalVideoTrack } from "livekit-client";
import { resolveLiveKitVideoCaptureOptions } from "@/src/lib/liveKitVideoQuality";

type WarmupState = {
  key: string;
  track: any | null;
  inFlight: boolean;
  consumed: boolean;
  facing: "front" | "back";
  startedAt: number;
  readyAt?: number;
  error?: string;
};

function readWarmupStore(): WarmupState | null {
  return (globalThis as any).__KRISTO_PREFLIGHT_VIDEO_WARMUP__ || null;
}

function writeWarmupStore(state: WarmupState | null) {
  (globalThis as any).__KRISTO_PREFLIGHT_VIDEO_WARMUP__ = state;
}

export function publisherWarmupKey(liveBridgeId: string, userId: string) {
  return `${String(liveBridgeId || "").trim()}|${String(userId || "").trim()}`;
}

export function clearPublisherVideoTrackWarmup() {
  const cur = readWarmupStore();

  // Only stop an unconsumed warmup track still owned by the warmup store.
  // Once takePublisherVideoTrackWarmup() consumes the track, ownership moves to
  // LiveKit publish/local preview. Stopping it here can end the published camera
  // track and cause publisher black preview + viewer flicker.
  if (cur?.track && !cur.consumed) {
    try {
      cur.track.stop?.();
    } catch {}
  }

  writeWarmupStore(null);
}

export function ensurePublisherVideoTrackWarmup(args: {
  liveBridgeId: string;
  userId: string;
  cameraFacing: "front" | "back";
  source: string;
}) {
  const liveBridgeId = String(args.liveBridgeId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!liveBridgeId || !userId) return;

  const key = publisherWarmupKey(liveBridgeId, userId);
  const cur = readWarmupStore();
  if (cur?.key === key && (cur.track || cur.inFlight)) return;

  if (cur && cur.key !== key) {
    clearPublisherVideoTrackWarmup();
  }

  const capture = resolveLiveKitVideoCaptureOptions();
  const startedAt = Date.now();
  const next: WarmupState = {
    key,
    track: null,
    inFlight: true,
    consumed: false,
    facing: args.cameraFacing,
    startedAt,
  };
  writeWarmupStore(next);

  console.log("KRISTO_PREFLIGHT_VIDEO_WARMUP_START", {
    source: args.source,
    liveBridgeId,
    userId,
    cameraFacing: args.cameraFacing,
  });

  void (async () => {
    try {
      const track = await createLocalVideoTrack({
        facingMode: args.cameraFacing === "front" ? "user" : "environment",
        resolution: capture.resolution,
      } as any);
      const latest = readWarmupStore();
      if (!latest || latest.key !== key || !latest.inFlight) {
        try {
          track.stop?.();
        } catch {}
        return;
      }
      writeWarmupStore({
        ...latest,
        track,
        inFlight: false,
        readyAt: Date.now(),
      });
      console.log("KRISTO_PREFLIGHT_VIDEO_WARMUP_READY", {
        source: args.source,
        liveBridgeId,
        ms: Date.now() - startedAt,
      });
    } catch (e: any) {
      const latest = readWarmupStore();
      if (!latest || latest.key !== key) return;
      writeWarmupStore({
        ...latest,
        inFlight: false,
        error: String(e?.message || e),
      });
      console.log("KRISTO_PREFLIGHT_VIDEO_WARMUP_ERROR", {
        source: args.source,
        liveBridgeId,
        message: String(e?.message || e),
      });
    }
  })();
}

export function takePublisherVideoTrackWarmup(
  liveBridgeId: string,
  userId: string
): any | null {
  const key = publisherWarmupKey(liveBridgeId, userId);
  const cur = readWarmupStore();
  if (!cur || cur.key !== key || !cur.track || cur.consumed) return null;
  const track = cur.track;
  writeWarmupStore({ ...cur, track: null, consumed: true });
  console.log("KRISTO_PREFLIGHT_VIDEO_WARMUP_CONSUMED", {
    liveBridgeId,
    userId,
    warmupMs: cur.readyAt ? cur.readyAt - cur.startedAt : null,
  });
  return track;
}

export function hasPublisherVideoTrackWarmupReady(
  liveBridgeId: string,
  userId: string
): boolean {
  const cur = readWarmupStore();
  return cur?.key === publisherWarmupKey(liveBridgeId, userId) && !!cur.track;
}

export function isPublisherVideoTrackWarmupInFlight(
  liveBridgeId: string,
  userId: string
): boolean {
  const cur = readWarmupStore();
  const key = publisherWarmupKey(liveBridgeId, userId);
  return cur?.key === key && cur.inFlight === true && !cur.track;
}

export function readPublisherVideoTrackWarmup(
  liveBridgeId: string,
  userId: string
): any | null {
  const cur = readWarmupStore();
  if (cur?.key !== publisherWarmupKey(liveBridgeId, userId) || !cur.track || cur.consumed) {
    return null;
  }
  const mediaTrack = cur.track?.mediaStreamTrack;
  if (!mediaTrack || String(mediaTrack.readyState || "") !== "live") {
    return null;
  }
  return cur.track;
}
