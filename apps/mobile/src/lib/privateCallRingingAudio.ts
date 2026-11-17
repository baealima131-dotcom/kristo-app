import type { AudioSource } from "expo-audio";

/**
 * Outgoing private-call audio, bundled as real mp3 assets (same files as the public release):
 * - Mountain_Waittone_2026-11-08T194359.mp3: plays while the call rings (max 29 s).
 * - ElevenLabs_2026-11-08T18_40_14__s50_sim75_v4.mp3: the "hapatikani kwa sasa" prompt,
 *   played only when the call is not answered or is declined.
 */
const WAITTONE_SOURCE: AudioSource = require("../../assets/sounds/calls/Mountain_Waittone_2026-11-08T194359.mp3");
const UNAVAILABLE_SOURCE: AudioSource = require("../../assets/sounds/calls/ElevenLabs_2026-11-08T18_40_14__s50_sim75_v4.mp3");

/** Used by the ongoing-call host, which keeps playing the prompt after the call screen closes. */
export const PRIVATE_CALL_UNAVAILABLE_SOURCE = UNAVAILABLE_SOURCE;

export type PrivateCallRingingAudioUris = {
  waittone: AudioSource;
  unavailable: AudioSource;
};

const SOURCES: PrivateCallRingingAudioUris = {
  waittone: WAITTONE_SOURCE,
  unavailable: UNAVAILABLE_SOURCE,
};

/** Kept async so the call screen API is unchanged; the assets ship inside the app bundle. */
export function ensurePrivateCallRingingAudioFiles(): Promise<PrivateCallRingingAudioUris> {
  return Promise.resolve(SOURCES);
}
