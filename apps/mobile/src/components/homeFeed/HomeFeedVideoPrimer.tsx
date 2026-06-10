import React from "react";
import { StyleSheet, View } from "react-native";
import { VideoView } from "expo-video";
import {
  getHomeFeedVideoPrimeSnapshot,
  markHomeFeedVideoPrimeFailed,
  markHomeFeedVideoPrimed,
  subscribeHomeFeedVideoPrime,
  type HomeFeedVideoPrimeSnapshot,
} from "@/src/lib/homeFeedVideoPrime";

/** A real, painted frame — playback position advanced past 0. */
const FIRST_FRAME_TIME = 0.03;
/** Decode of a cold moov-at-end file can legitimately take many seconds. */
const PRIME_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

/**
 * Always-mounted, effectively-invisible `VideoView` that decode-primes the first
 * Home Feed video BEFORE Home opens.
 *
 * Mount this once near the app root. It does nothing until startup calls
 * `requestHomeFeedVideoPrime(url)`; then it attaches the parked player to a tiny
 * hidden surface, plays it muted until the first frame paints, pauses on that
 * frame, and keeps it mounted until the visible Home Feed row adopts it.
 *
 * An ATTACHED VideoView is required: iOS AVPlayer only decodes once its layer is
 * attached to a live view, which is why unattached priming produced no frame.
 */
export function HomeFeedVideoPrimer() {
  const [snapshot, setSnapshot] = React.useState<HomeFeedVideoPrimeSnapshot>(
    getHomeFeedVideoPrimeSnapshot
  );

  React.useEffect(
    () => subscribeHomeFeedVideoPrime(() => setSnapshot(getHomeFeedVideoPrimeSnapshot())),
    []
  );

  const player = snapshot?.player ?? null;
  const rawUrl = snapshot?.rawUrl ?? "";
  const url = snapshot?.url ?? "";
  const primed = snapshot?.primed ?? false;

  // Drive the decode-prime once the player exists and its VideoView is attached
  // (this effect runs after the VideoView below has mounted). Muted play until
  // first frame, then pause AT that frame and report readiness.
  React.useEffect(() => {
    if (!player || !url || primed) return;

    let settled = false;

    const finish = (painted: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      try {
        player.pause();
      } catch {}
      if (painted) markHomeFeedVideoPrimed(rawUrl || url);
      else markHomeFeedVideoPrimeFailed(rawUrl || url, "no-first-frame");
    };

    try {
      player.muted = true;
      player.play();
    } catch {
      finish(false);
      return;
    }
    console.log("KRISTO_VIDEO_PRIME_STARTED", { url, attached: true });

    const poll = setInterval(() => {
      if (settled) return;
      let t = 0;
      try {
        t = Number((player as any).currentTime) || 0;
      } catch {}
      if (t > FIRST_FRAME_TIME) {
        finish(true);
      } else {
        // If something paused us before the first frame, keep nudging it.
        let playing = false;
        try {
          playing = Boolean((player as any).playing);
        } catch {}
        if (!playing) {
          try {
            player.play();
          } catch {}
        }
      }
    }, POLL_MS);

    const timeout = setTimeout(() => finish(false), PRIME_TIMEOUT_MS);

    return () => {
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [player, rawUrl, url, primed]);

  if (!player) return null;

  return (
    <View pointerEvents="none" style={styles.host} collapsable={false} needsOffscreenAlphaCompositing>
      <VideoView
        player={player}
        style={styles.surface}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-bleed but pushed BEHIND all app content (zIndex -1) at a near-zero,
  // NON-ZERO opacity. iOS only decodes a player whose layer is actually
  // rendered; a fully transparent (opacity:0) or zero-area surface can be
  // optimized away by the render server, which is why the layer must be both
  // laid out at real size and composited (opacity > 0) — yet imperceptible and
  // covered by the splash/Home Feed on top.
  host: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.02,
    zIndex: -1,
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
  },
});
