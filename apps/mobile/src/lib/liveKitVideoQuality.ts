export type LiveKitVideoTier = "low" | "normal" | "high";

export type LiveKitVideoCaptureOptions = {
  tier: LiveKitVideoTier;
  resolution: {
    width: number;
    height: number;
    frameRate: number;
  };
  maxBitrate: number;
};

/** Default mobile capture: 720p; upgrade on strong network, downgrade only when constrained. */
export function resolveLiveKitVideoTier(): LiveKitVideoTier {
  const forced = String((globalThis as any).__KRISTO_LIVE_VIDEO_TIER__ || "").trim();
  if (forced === "low" || forced === "normal" || forced === "high") {
    return forced;
  }

  const networkHint = String((globalThis as any).__KRISTO_LIVE_NETWORK_TIER__ || "").trim();
  if (networkHint === "low") return "low";
  if (networkHint === "high") return "high";

  return "normal";
}

export function resolveLiveKitVideoCaptureOptions(
  tier: LiveKitVideoTier = resolveLiveKitVideoTier()
): LiveKitVideoCaptureOptions {
  switch (tier) {
    case "low":
      return {
        tier,
        resolution: { width: 960, height: 540, frameRate: 20 },
        maxBitrate: 900_000,
      };
    case "high":
      return {
        tier,
        resolution: { width: 1920, height: 1080, frameRate: 24 },
        maxBitrate: 2_500_000,
      };
    default:
      return {
        tier: "normal",
        resolution: { width: 1280, height: 720, frameRate: 24 },
        maxBitrate: 1_600_000,
      };
  }
}

export function buildLiveKitRoomOptions() {
  return {
    adaptiveStream: true,
    dynacast: true,
    stopLocalTrackOnUnpublish: true,
    disconnectOnPageLeave: false,
    publishDefaults: {
      simulcast: true,
      videoCodec: "h264" as const,
      dtx: true,
      red: true,
    },
  };
}
