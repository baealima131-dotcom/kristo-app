import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

// Test recording (Swahili, English, Kirundi, French): "the person you are calling is not available".
const UNAVAILABLE_TONE_SOURCE = require("../../assets/sounds/calls/ELEVENLAB 1.mp3");

// The recording is ~24 s; this only guards against a player that never reports the end.
const UNAVAILABLE_TONE_MAX_MS = 30_000;

const UNAVAILABLE_TONE_STATUSES = new Set(["timeout", "failed", "declined"]);

export function shouldPlayPrivateCallUnavailableTone(role: string, status?: string | null) {
  return role === "caller" && UNAVAILABLE_TONE_STATUSES.has(String(status || "").trim());
}

export type PrivateCallUnavailableTone = {
  finished: Promise<void>;
  stop: () => void;
};

/** Plays the unavailable message once; `finished` resolves when it ends, fails or is stopped. */
export function playPrivateCallUnavailableTone(callId: string, status: string): PrivateCallUnavailableTone {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  let settle: () => void = () => {};
  let done = false;
  const startedAt = Date.now();

  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const finish = (reason: string) => {
    if (done) return;
    done = true;
    clearTimeout(guardTimer);
    try {
      player?.pause();
      player?.remove();
    } catch {}
    player = null;
    console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_TONE_DONE", {
      callId,
      status,
      reason,
      ms: Date.now() - startedAt,
    });
    settle();
  };

  const guardTimer = setTimeout(() => finish("guard-timeout"), UNAVAILABLE_TONE_MAX_MS);

  (async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (done) return;
      player = createAudioPlayer(UNAVAILABLE_TONE_SOURCE);
      player.loop = false;
      player.addListener("playbackStatusUpdate", (playback) => {
        if (playback.didJustFinish) finish("ended");
      });
      player.play();
      console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_TONE_START", { callId, status });
    } catch (error: any) {
      console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_TONE_ERROR", {
        callId,
        status,
        message: String(error?.message || error),
      });
      finish("error");
    }
  })();

  return { finished, stop: () => finish("stopped") };
}
