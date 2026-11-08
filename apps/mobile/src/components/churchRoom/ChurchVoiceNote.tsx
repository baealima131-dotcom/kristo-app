import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

/** Church Members room voice notes (server deletes them after 7 days). */
export const CHURCH_VOICE_NOTE_MAX_MS = 5 * 60 * 1000;
export const CHURCH_VOICE_NOTE_MIME = Platform.OS === "ios" ? "audio/mp4" : "audio/m4a";

const GOLD = "#F5D780";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Length of the recorded file itself, so the bubble shows the same duration before and after
 * the audio loads. Falls back to the recording timer if the file cannot be read in time.
 */
async function recordedFileDurationMs(uri: string, fallbackMs: number) {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  try {
    player = createAudioPlayer({ uri });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const seconds = Number(player.duration || 0);
      if (player.isLoaded && seconds > 0) return Math.round(seconds * 1000);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch {
  } finally {
    try {
      player?.remove();
    } catch {}
  }
  return fallbackMs;
}

function formatClock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** WhatsApp-style chat day label: Today, Yesterday, weekday (last 7 days), then the date. */
export function chatDayLabel(ms: number, nowMs = Date.now()) {
  const day = new Date(ms);
  const today = new Date(nowMs);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(day)) / DAY_MS);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return day.toLocaleDateString("en-US", { weekday: "long" });
  return day.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(day.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function chatDayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function ChatDateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateRow} accessibilityRole="header">
      <View style={styles.datePill}>
        <Text style={styles.dateText}>{label}</Text>
      </View>
    </View>
  );
}

/** Mic button; recording happens in a small panel so the composer layout is untouched. */
export function ChurchVoiceNoteButton({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (uri: string, durationMs: number, mime: string) => Promise<void>;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const startedAtRef = useRef(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dot = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 0.25, duration: 520, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 1, duration: 520, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [recording, dot]);

  const resetAudioMode = useCallback(async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {}
  }, []);

  const stopRecording = useCallback(
    async (send: boolean) => {
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
      const timerMs = Math.min(
        CHURCH_VOICE_NOTE_MAX_MS,
        startedAtRef.current ? Date.now() - startedAtRef.current : Number(recorderState.durationMillis || 0)
      );
      try {
        await recorder.stop();
      } catch {}
      await resetAudioMode();
      setRecording(false);
      startedAtRef.current = 0;
      const uri = String(recorder.uri || "").trim();
      if (!send) return;
      if (!uri || timerMs < 700) {
        Alert.alert("Voice note too short", "Hold on a little longer before sending.");
        return;
      }
      setSending(true);
      try {
        const durationMs = Math.min(CHURCH_VOICE_NOTE_MAX_MS, await recordedFileDurationMs(uri, timerMs));
        await onSend(uri, durationMs, CHURCH_VOICE_NOTE_MIME);
      } catch (e: any) {
        Alert.alert("Voice note not sent", String(e?.message || "Please try again."));
      } finally {
        setSending(false);
      }
    },
    [onSend, recorder, recorderState.durationMillis, resetAudioMode]
  );

  const startRecording = useCallback(async () => {
    if (disabled || recording || sending) return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone permission required", "Allow microphone access to record a voice note.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      setRecording(true);
      autoStopRef.current = setTimeout(() => void stopRecording(true), CHURCH_VOICE_NOTE_MAX_MS);
    } catch (e: any) {
      await resetAudioMode();
      Alert.alert("Could not start recording", String(e?.message || "Please try again."));
    }
  }, [disabled, recorder, recording, resetAudioMode, sending, stopRecording]);

  useEffect(
    () => () => {
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    },
    []
  );

  const elapsed = recording
    ? Math.max(Number(recorderState.durationMillis || 0), Date.now() - startedAtRef.current)
    : 0;

  return (
    <>
      <Pressable
        onPress={() => void startRecording()}
        disabled={disabled || sending}
        accessibilityLabel="Record voice note"
        style={({ pressed }) => [
          styles.micBtn,
          disabled ? styles.micBtnDisabled : null,
          pressed ? { transform: [{ scale: 0.95 }], opacity: 0.9 } : null,
        ]}
      >
        {sending ? (
          <ActivityIndicator size="small" color="#1B1404" />
        ) : (
          <Ionicons name="mic" size={18} color={disabled ? "rgba(255,255,255,0.3)" : "#1B1404"} />
        )}
      </Pressable>

      <Modal visible={recording} transparent animationType="fade" onRequestClose={() => void stopRecording(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetRow}>
              <Animated.View style={[styles.recDot, { opacity: dot }]} />
              <Text style={styles.recTime}>{formatClock(elapsed)}</Text>
              <Text style={styles.recHint} numberOfLines={1}>
                Recording voice note
              </Text>
            </View>
            <Text style={styles.recNote}>Voice notes are deleted automatically after 7 days.</Text>
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => void stopRecording(false)}
                accessibilityLabel="Cancel voice note"
                style={({ pressed }) => [styles.cancelBtn, pressed ? { opacity: 0.8 } : null]}
              >
                <Ionicons name="trash-outline" size={18} color="#FF8A80" />
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void stopRecording(true)}
                accessibilityLabel="Send voice note"
                style={({ pressed }) => [styles.sendBtn, pressed ? { opacity: 0.85 } : null]}
              >
                <Ionicons name="send" size={16} color="#1B1404" />
                <Text style={styles.sendText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Playable voice note bubble; same look for every sender (the row's side and avatar show who sent it). */
export function ChurchVoiceNoteBubble({
  url,
  durationMs,
  expiresAt,
  nowMs,
}: {
  url: string;
  durationMs?: number;
  expiresAt?: number;
  nowMs: number;
}) {
  const player = useAudioPlayer(url ? { uri: url } : null);
  const status = useAudioPlayerStatus(player);
  const totalMs = Number(status.duration || 0) > 0 ? status.duration * 1000 : Number(durationMs || 0);
  const positionMs = Number(status.currentTime || 0) * 1000;
  const progress = totalMs > 0 ? Math.min(1, positionMs / totalMs) : 0;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - nowMs) / DAY_MS)) : null;

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [player, status.didJustFinish]);

  const toggle = async () => {
    if (!url) return;
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {}
    if (status.playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.voiceBubble}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityLabel={status.playing ? "Pause voice note" : "Play voice note"}
        style={({ pressed }) => [styles.playBtn, pressed ? { opacity: 0.85 } : null]}
      >
        <Ionicons name={status.playing ? "pause" : "play"} size={18} color="#1B1404" />
      </Pressable>
      <View style={styles.voiceBody}>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.voiceMeta}>
          <Text style={styles.voiceTime}>
            {formatClock(status.playing || positionMs > 0 ? positionMs : totalMs)}
          </Text>
          {daysLeft != null ? (
            <Text style={styles.voiceExpiry}>
              {daysLeft <= 1 ? "Expires today" : `Expires in ${daysLeft} days`}
            </Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="mic" size={14} color="rgba(245,215,128,0.75)" />
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { alignItems: "center", marginVertical: 10 },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  dateText: { color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "700" },

  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  micBtnDisabled: { backgroundColor: "rgba(255,255,255,0.10)" },

  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    margin: 12,
    marginBottom: 28,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "rgba(245,215,128,0.28)",
  },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#FF4D4F" },
  recTime: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  recHint: { flex: 1, color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
  recNote: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 12 },
  sheetActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, gap: 12 },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,138,128,0.45)",
  },
  cancelText: { color: "#FF8A80", fontWeight: "800" },
  sendBtn: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: GOLD,
  },
  sendText: { color: "#1B1404", fontWeight: "800" },

  voiceBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 220,
    maxWidth: 280,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  voiceBody: { flex: 1, gap: 6 },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.16)", overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: GOLD },
  voiceMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  voiceTime: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  voiceExpiry: { color: "rgba(255,255,255,0.5)", fontSize: 11 },
});
