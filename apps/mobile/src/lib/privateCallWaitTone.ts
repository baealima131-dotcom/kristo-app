import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

// Test wait tone the caller hears while the call rings (the file is ~30 s, the ring timeout).
const WAIT_TONE_SOURCE = require("../../assets/sounds/calls/Mountain_Waittone_2026-11-08T194359.mp3");

/** Same as the server ring timeout (RING_TIMEOUT_MS). */
export const PRIVATE_CALL_WAIT_TONE_MS = 30_000;

/** Plays the wait tone for at most `maxMs`; `stop` ends it at once (answer, cancel, timeout). */
export function playPrivateCallWaitTone(callId: string, maxMs = PRIVATE_CALL_WAIT_TONE_MS) {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  let done = false;
  const startedAt = Date.now();

  const stop = (reason = "stopped") => {
    if (done) return;
    done = true;
    clearTimeout(limitTimer);
    try {
      player?.pause();
      player?.remove();
    } catch {}
    player = null;
    console.log("KRISTO_PRIVATE_CALL_WAIT_TONE_STOP", { callId, reason, ms: Date.now() - startedAt });
  };

  const limitTimer = setTimeout(() => stop("limit"), Math.max(0, maxMs));

  (async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (done) return;
      player = createAudioPlayer(WAIT_TONE_SOURCE);
      player.loop = false;
      player.play();
      console.log("KRISTO_PRIVATE_CALL_WAIT_TONE_START", { callId, maxMs });
    } catch (error: any) {
      console.log("KRISTO_PRIVATE_CALL_WAIT_TONE_ERROR", { callId, message: String(error?.message || error) });
      stop("error");
    }
  })();

  return { stop };
}
