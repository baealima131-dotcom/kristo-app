import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  sendMessage,
  type AppointmentVoiceNote,
} from "@/src/lib/messagesStore";
import {
  extractApiErrorMessage,
  uploadMessageAttachment,
} from "@/src/lib/messageAttachmentUpload";

const GOLD = "#D9B35F";
const GOLD_BRIGHT = "#F4D06F";
const MAX_TEXT_LENGTH = 500;
const MAX_VOICE_NOTES = 5;
const MAX_RECORDING_MS = 60_000;

type LocalVoiceNote = AppointmentVoiceNote & {
  local: true;
};

function appointmentId() {
  return `appointment_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
}

function voiceNoteId() {
  return `voice_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(
    0,
    Math.min(
      60,
      Math.round(Number(milliseconds || 0) / 1000)
    )
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function VoiceSlot({
  index,
  note,
  disabled,
  onDelete,
}: {
  index: number;
  note: LocalVoiceNote | null;
  disabled: boolean;
  onDelete: () => void;
}) {
  const player = useAudioPlayer(
    note?.uri ? { uri: note.uri } : null,
    {
      updateInterval: 200,
    }
  );

  const status = useAudioPlayerStatus(player);

  const togglePlayback = useCallback(() => {
    if (!note?.uri || disabled) return;

    if (status.playing) {
      player.pause();
      return;
    }

    if (
      Number(status.currentTime || 0) >=
      Number(status.duration || 0) - 0.1
    ) {
      player.seekTo(0);
    }

    player.play();
  }, [
    disabled,
    note?.uri,
    player,
    status.currentTime,
    status.duration,
    status.playing,
  ]);

  return (
    <View
      style={[
        styles.voiceSlot,
        note ? styles.voiceSlotFilled : null,
      ]}
    >
      {note ? (
        <>
          <Pressable
            disabled={disabled}
            onPress={togglePlayback}
            style={({ pressed }) => [
              styles.voicePlayButton,
              status.playing
                ? styles.voicePlayButtonActive
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons
              name={
                status.playing
                  ? "pause"
                  : "play"
              }
              size={19}
              color={
                status.playing
                  ? "#10140E"
                  : GOLD_BRIGHT
              }
            />
          </Pressable>

          <Text style={styles.voiceSlotLabel}>
            Voice {index + 1}
          </Text>

          <Text style={styles.voiceSlotDuration}>
            {formatDuration(note.durationSec * 1000)}
          </Text>

          <Pressable
            disabled={disabled}
            onPress={onDelete}
            hitSlop={8}
            style={({ pressed }) => [
              styles.voiceDeleteButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons
              name="trash-outline"
              size={14}
              color="#FF7D84"
            />
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.voiceEmptyIcon}>
            <Ionicons
              name="mic-outline"
              size={20}
              color="rgba(217,179,95,0.50)"
            />
          </View>

          <Text style={styles.voiceEmptyNumber}>
            {index + 1}
          </Text>

          <Text style={styles.voiceEmptyDuration}>
            Empty
          </Text>
        </>
      )}
    </View>
  );
}

export default function DirectMessageAppointmentComposer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    roomId?: string;
    threadId?: string;
    recipientId?: string;
    recipientName?: string;
    roomKind?: string;
    churchId?: string;
    source?: string;
  }>();

  const roomId = String(params.roomId || "").trim();

  const threadId = String(
    params.threadId || params.roomId || ""
  ).trim();

  const recipientId = String(
    params.recipientId || ""
  ).trim();

  const recipientName =
    String(params.recipientName || "").trim() ||
    "Member";

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceNotes, setVoiceNotes] = useState<
    LocalVoiceNote[]
  >([]);
  const [recordingStartedAt, setRecordingStartedAt] =
    useState(0);

  const recorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY
  );

  const recorderState = useAudioRecorderState(
    recorder,
    100
  );

  const recordingGuardRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const autoStopTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const trimmedMessage = message.trim();
  const remaining =
    MAX_TEXT_LENGTH - message.length;

  const isRecording =
    recorderState.isRecording ||
    recordingGuardRef.current;

  const recordedMilliseconds = Math.min(
    MAX_RECORDING_MS,
    Math.max(
      Number(recorderState.durationMillis || 0),
      recordingStartedAt
        ? Date.now() - recordingStartedAt
        : 0
    )
  );

  const canSend = useMemo(
    () =>
      !!roomId &&
      !!recipientId &&
      (!!trimmedMessage ||
        voiceNotes.length > 0) &&
      trimmedMessage.length <= MAX_TEXT_LENGTH &&
      !sending &&
      !isRecording,
    [
      roomId,
      recipientId,
      trimmedMessage,
      voiceNotes.length,
      sending,
      isRecording,
    ]
  );

  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
      }

      if (recordingGuardRef.current) {
        void recorder.stop().catch(() => {});
      }
    };
  }, [recorder]);

  const stopRecording = useCallback(
    async (reason: "released" | "limit") => {
      if (
        !recordingGuardRef.current ||
        stopInFlightRef.current
      ) {
        return;
      }

      stopInFlightRef.current = true;

      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }

      const elapsedMs = Math.max(
        300,
        Math.min(
          MAX_RECORDING_MS,
          recordingStartedAt
            ? Date.now() - recordingStartedAt
            : Number(
                recorderState.durationMillis || 0
              )
        )
      );

      try {
        await recorder.stop();

        const uri = String(
          recorder.uri || ""
        ).trim();

        if (!uri) {
          throw new Error(
            "The recording file could not be created."
          );
        }

        const nextNote: LocalVoiceNote = {
          id: voiceNoteId(),
          uri,
          durationSec: Math.max(
            1,
            Math.min(
              60,
              Math.round(elapsedMs / 1000)
            )
          ),
          mime:
            Platform.OS === "ios"
              ? "audio/mp4"
              : "audio/m4a",
          name: `appointment-voice-${
            voiceNotes.length + 1
          }.m4a`,
          local: true,
        };

        setVoiceNotes((current) => {
          if (
            current.length >=
            MAX_VOICE_NOTES
          ) {
            return current;
          }

          return [...current, nextNote];
        });

        console.log(
          "KRISTO_APPOINTMENT_VOICE_RECORDED",
          {
            reason,
            durationSec:
              nextNote.durationSec,
            voiceCount:
              voiceNotes.length + 1,
            hasUri: true,
          }
        );
      } catch (error: any) {
        Alert.alert(
          "Recording failed",
          extractApiErrorMessage(
            error,
            "The voice message could not be saved."
          )
        );
      } finally {
        recordingGuardRef.current = false;
        stopInFlightRef.current = false;
        setRecordingStartedAt(0);

        try {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          });
        } catch {}
      }
    },
    [
      recorder,
      recorderState.durationMillis,
      recordingStartedAt,
      voiceNotes.length,
    ]
  );

  const startRecording = useCallback(
    async () => {
      if (
        sending ||
        stopInFlightRef.current ||
        recordingGuardRef.current
      ) {
        return;
      }

      if (
        voiceNotes.length >=
        MAX_VOICE_NOTES
      ) {
        Alert.alert(
          "Five voice messages maximum",
          "Delete one voice message before recording another."
        );
        return;
      }

      try {
        const permission =
          await requestRecordingPermissionsAsync();

        if (!permission.granted) {
          Alert.alert(
            "Microphone permission required",
            "Allow microphone access in iPhone Settings to record an appointment request."
          );
          return;
        }

        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });

        await recorder.prepareToRecordAsync();

        recordingGuardRef.current = true;
        stopInFlightRef.current = false;

        const startedAt = Date.now();
        setRecordingStartedAt(startedAt);

        recorder.record({
          forDuration: 60,
        });

        autoStopTimerRef.current = setTimeout(
          () => {
            void stopRecording("limit");
          },
          MAX_RECORDING_MS
        );

        console.log(
          "KRISTO_APPOINTMENT_VOICE_RECORDING_STARTED",
          {
            targetSlot:
              voiceNotes.length + 1,
            maxSeconds: 60,
          }
        );
      } catch (error: any) {
        recordingGuardRef.current = false;
        setRecordingStartedAt(0);

        Alert.alert(
          "Cannot start recording",
          extractApiErrorMessage(
            error,
            "Please try again."
          )
        );
      }
    },
    [
      recorder,
      sending,
      stopRecording,
      voiceNotes.length,
    ]
  );

  function deleteVoice(index: number) {
    if (sending || isRecording) return;

    setVoiceNotes((current) =>
      current.filter(
        (_, currentIndex) =>
          currentIndex !== index
      )
    );
  }

  async function uploadVoiceNotes(
    headers: Record<string, string>
  ): Promise<AppointmentVoiceNote[]> {
    const uploadHeaders = {
      ...headers,
    };

    delete uploadHeaders["Content-Type"];
    delete uploadHeaders["content-type"];

    const uploaded: AppointmentVoiceNote[] = [];

    for (
      let index = 0;
      index < voiceNotes.length;
      index += 1
    ) {
      const note = voiceNotes[index];

      const attachment =
        await uploadMessageAttachment(
          {
            id: note.id,
            kind: "file",
            localUri: note.uri,
            name:
              note.name ||
              `appointment-voice-${
                index + 1
              }.m4a`,
            mime:
              note.mime ||
              "audio/mp4",
          },
          uploadHeaders
        );

      const remoteUri = String(
        attachment.url ||
          attachment.uri ||
          attachment.fileUri ||
          ""
      ).trim();

      if (!remoteUri) {
        throw new Error(
          `Voice ${index + 1} could not be uploaded.`
        );
      }

      uploaded.push({
        id: note.id,
        uri: remoteUri,
        durationSec: note.durationSec,
        mime:
          attachment.mime ||
          attachment.mimeType ||
          note.mime ||
          "audio/mp4",
        name:
          attachment.name ||
          attachment.fileName ||
          note.name,
      });
    }

    return uploaded;
  }

  async function sendAppointmentRequest() {
    if (!roomId) {
      Alert.alert(
        "Appointment",
        "The conversation room could not be found."
      );
      return;
    }

    if (!recipientId) {
      Alert.alert(
        "Appointment",
        "The appointment recipient could not be found."
      );
      return;
    }

    if (
      !trimmedMessage &&
      voiceNotes.length === 0
    ) {
      Alert.alert(
        "Add your request",
        "Write a message or record at least one voice message."
      );
      return;
    }

    if (
      trimmedMessage.length >
      MAX_TEXT_LENGTH
    ) {
      Alert.alert(
        "Message too long",
        "Appointment messages cannot exceed 500 characters."
      );
      return;
    }

    const headers: Record<string, string> = {
      ...(getKristoHeaders() as Record<
        string,
        string
      >),
      "Content-Type": "application/json",
    };

    const requesterId = String(
      headers["x-kristo-user-id"] || ""
    ).trim();

    if (!requesterId) {
      Alert.alert(
        "Sign in required",
        "Please sign in again before sending an appointment request."
      );
      return;
    }

    const id = appointmentId();
    const createdAt = Date.now();

    setSending(true);

    try {
      const uploadedVoiceNotes =
        await uploadVoiceNotes(headers);

      const base = String(
        getApiBase() || ""
      ).replace(/\/+$/, "");

      const card = {
        type: "appointment_request",
        appointmentId: id,
        status: "pending",
        requesterId,
        recipientId,
        requesterName: String(
          headers["x-kristo-user-name"] ||
            headers[
              "x-kristo-display-name"
            ] ||
            "Member"
        ),
        recipientName,
        message: trimmedMessage,
        voiceNotes: uploadedVoiceNotes,
        createdAt,
      };

      const response = await fetch(
        `${base}/api/church/room-messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            roomId,
            roomKind: "direct",
            kind: "appointment_request",
            text: trimmedMessage,
            attachments: [],
            clientId: id,
            card,
          }),
        }
      );

      const payload = await response
        .json()
        .catch(() => null);

      if (
        !response.ok ||
        payload?.ok === false
      ) {
        throw new Error(
          String(
            payload?.message ||
              payload?.error ||
              "Could not send the appointment request."
          )
        );
      }

      const serverMessage =
        payload?.data ||
        payload?.message ||
        payload?.item ||
        null;

      sendMessage(
        threadId || roomId,
        {
          id: String(
            serverMessage?.id ||
              `local_${id}`
          ),
          clientId: id,
          text: trimmedMessage,
          attachments: [],
          createdAt: Number(
            serverMessage?.createdAt ||
              createdAt
          ),
          pending: false,
          senderUserId: requesterId,
          displayName: String(
            headers["x-kristo-user-name"] ||
              headers[
                "x-kristo-display-name"
              ] ||
              "Me"
          ),
          senderRole: String(
            headers["x-kristo-role"] ||
              ""
          ),
          kind: "appointment_request",
          card,
        },
        {
          disableAutoReply: true,
        }
      );

      console.log(
        "KRISTO_DM_APPOINTMENT_REQUEST_SENT",
        {
          appointmentId: id,
          roomId,
          threadId,
          recipientId,
          recipientName,
          textLength:
            trimmedMessage.length,
          voiceCount:
            uploadedVoiceNotes.length,
          insertedIntoLocalStore: true,
        }
      );

      Alert.alert(
        "Request sent",
        `Your appointment request was sent to ${recipientName}.`,
        [
          {
            text: "Back to chat",
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        "Could not send request",
        extractApiErrorMessage(
          error,
          "Please check your connection and try again."
        )
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={
        Platform.OS === "ios"
          ? "padding"
          : undefined
      }
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(
              insets.top,
              14
            ),
          },
        ]}
      >
        <Pressable
          disabled={sending || isRecording}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color="#FFFFFF"
          />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>
            Request appointment
          </Text>

          <Text
            style={styles.headerSubtitle}
            numberOfLines={1}
          >
            Send to {recipientName}
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(
              insets.bottom + 28,
              40
            ),
          },
        ]}
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Write your request
          </Text>

          <Text
            style={[
              styles.counter,
              remaining < 0
                ? styles.counterDanger
                : null,
            ]}
          >
            {message.length} /{" "}
            {MAX_TEXT_LENGTH}
          </Text>
        </View>

        <TextInput
          value={message}
          editable={!sending && !isRecording}
          onChangeText={(value) =>
            setMessage(
              value.slice(
                0,
                MAX_TEXT_LENGTH
              )
            )
          }
          placeholder="Write why you are requesting this appointment..."
          placeholderTextColor="rgba(255,255,255,0.28)"
          multiline
          maxLength={MAX_TEXT_LENGTH}
          textAlignVertical="top"
          style={styles.input}
        />

        <View style={styles.voiceHeader}>
          <View>
            <Text style={styles.sectionTitle}>
              Voice messages
            </Text>
            <Text style={styles.voiceSubtitle}>
              Hold the button to record
            </Text>
          </View>

          <View style={styles.voiceCountPill}>
            <Text style={styles.voiceCountText}>
              {voiceNotes.length} / 5
            </Text>
          </View>
        </View>

        <View style={styles.voiceSlots}>
          {[0, 1, 2, 3, 4].map(
            (index) => (
              <VoiceSlot
                key={`appointment_voice_${index}_${
                  voiceNotes[index]?.id ||
                  "empty"
                }`}
                index={index}
                note={
                  voiceNotes[index] || null
                }
                disabled={
                  sending || isRecording
                }
                onDelete={() =>
                  deleteVoice(index)
                }
              />
            )
          )}
        </View>

        <Pressable
          disabled={
            sending ||
            voiceNotes.length >=
              MAX_VOICE_NOTES
          }
          onPressIn={() => {
            void startRecording();
          }}
          onPressOut={() => {
            void stopRecording("released");
          }}
          style={({ pressed }) => [
            styles.recordButton,
            isRecording
              ? styles.recordButtonActive
              : null,
            voiceNotes.length >=
            MAX_VOICE_NOTES
              ? styles.recordButtonDisabled
              : null,
            pressed && !isRecording
              ? styles.recordButtonPressed
              : null,
          ]}
        >
          <View
            style={[
              styles.recordIconRing,
              isRecording
                ? styles.recordIconRingActive
                : null,
            ]}
          >
            {isRecording ? (
              <View style={styles.stopSquare} />
            ) : (
              <Ionicons
                name="mic"
                size={26}
                color={GOLD_BRIGHT}
              />
            )}
          </View>

          <View style={styles.recordCopy}>
            <Text
              style={[
                styles.recordTitle,
                isRecording
                  ? styles.recordTitleActive
                  : null,
              ]}
            >
              {isRecording
                ? "Recording voice..."
                : voiceNotes.length >=
                    MAX_VOICE_NOTES
                  ? "Five voice messages added"
                  : "Hold to record voice"}
            </Text>

            <Text style={styles.recordHint}>
              {isRecording
                ? "Release to save • Stops automatically at 60 seconds"
                : "Maximum 60 seconds per voice"}
            </Text>
          </View>

          <Text
            style={[
              styles.recordTimer,
              isRecording
                ? styles.recordTimerActive
                : null,
            ]}
          >
            {isRecording
              ? formatDuration(
                  recordedMilliseconds
                )
              : "0:60"}
          </Text>
        </Pressable>

        <Pressable
          disabled={!canSend}
          onPress={sendAppointmentRequest}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend
              ? styles.sendButtonDisabled
              : null,
            pressed && canSend
              ? styles.sendButtonPressed
              : null,
          ]}
        >
          {sending ? (
            <>
              <ActivityIndicator
                color="#171208"
              />
              <Text style={styles.sendText}>
                Uploading and sending...
              </Text>
            </>
          ) : (
            <>
              <Ionicons
                name="send"
                size={18}
                color="#171208"
              />
              <Text style={styles.sendText}>
                Send appointment request
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#070A11",
  },

  header: {
    minHeight: 82,
    paddingHorizontal: 16,
    paddingBottom: 13,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(255,255,255,0.065)",
    backgroundColor: "rgba(7,10,17,0.99)",
  },

  headerButton: {
    width: 45,
    height: 45,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },

  headerText: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 13,
  },

  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: -0.25,
  },

  headerSubtitle: {
    marginTop: 3,
    color: "rgba(255,255,255,0.48)",
    fontSize: 11.5,
    fontWeight: "700",
  },

  headerSpacer: {
    width: 45,
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionTitle: {
    color: "rgba(255,255,255,0.96)",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
  },

  counter: {
    color: "rgba(217,179,95,0.92)",
    fontSize: 11.5,
    fontWeight: "900",
  },

  counterDanger: {
    color: "#FF7D84",
  },

  input: {
    marginTop: 12,
    minHeight: 150,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderRadius: 22,
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    backgroundColor: "rgba(14,18,28,0.90)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },

  voiceHeader: {
    marginTop: 25,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  voiceSubtitle: {
    marginTop: 3,
    color: "rgba(255,255,255,0.38)",
    fontSize: 10,
    fontWeight: "700",
  },

  voiceCountPill: {
    minWidth: 48,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.22)",
  },

  voiceCountText: {
    color: "rgba(244,208,111,0.90)",
    fontSize: 10,
    fontWeight: "900",
  },

  voiceSlots: {
    width: "100%",
    flexDirection: "row",
    gap: 7,
  },

  voiceSlot: {
    flex: 1,
    minWidth: 0,
    height: 119,
    paddingHorizontal: 3,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(13,17,27,0.88)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },

  voiceSlotFilled: {
    backgroundColor:
      "rgba(217,179,95,0.065)",
    borderColor:
      "rgba(217,179,95,0.30)",
    shadowColor: GOLD,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4,
    },
  },

  voiceEmptyIcon: {
    width: 39,
    height: 39,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.055)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.14)",
  },

  voiceEmptyNumber: {
    marginTop: 8,
    color: "rgba(255,255,255,0.48)",
    fontSize: 10,
    fontWeight: "900",
  },

  voiceEmptyDuration: {
    marginTop: 3,
    color: "rgba(255,255,255,0.25)",
    fontSize: 8,
    fontWeight: "700",
  },

  voicePlayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.32)",
  },

  voicePlayButtonActive: {
    backgroundColor: GOLD_BRIGHT,
    borderColor:
      "rgba(255,236,179,0.85)",
  },

  voiceSlotLabel: {
    marginTop: 7,
    color: "rgba(255,255,255,0.88)",
    fontSize: 9,
    fontWeight: "900",
  },

  voiceSlotDuration: {
    marginTop: 2,
    color: "rgba(244,208,111,0.70)",
    fontSize: 8.5,
    fontWeight: "800",
  },

  voiceDeleteButton: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,80,90,0.08)",
  },

  recordButton: {
    marginTop: 18,
    minHeight: 78,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 23,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor:
      "rgba(18,22,32,0.96)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.23)",
    shadowColor: GOLD,
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 6,
    },
  },

  recordButtonActive: {
    backgroundColor:
      "rgba(55,18,24,0.94)",
    borderColor:
      "rgba(255,86,96,0.58)",
    shadowColor: "#FF5964",
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },

  recordButtonDisabled: {
    opacity: 0.48,
    shadowOpacity: 0,
  },

  recordButtonPressed: {
    transform: [{ scale: 0.988 }],
    borderColor:
      "rgba(244,208,111,0.52)",
  },

  recordIconRing: {
    width: 53,
    height: 53,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.34)",
  },

  recordIconRingActive: {
    backgroundColor:
      "rgba(255,81,91,0.15)",
    borderColor:
      "rgba(255,101,111,0.72)",
  },

  stopSquare: {
    width: 17,
    height: 17,
    borderRadius: 4,
    backgroundColor: "#FF6973",
  },

  recordCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },

  recordTitle: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 13,
    fontWeight: "900",
  },

  recordTitleActive: {
    color: "#FF8A91",
  },

  recordHint: {
    marginTop: 4,
    color: "rgba(255,255,255,0.42)",
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: "700",
  },

  recordTimer: {
    marginLeft: 8,
    color: "rgba(244,208,111,0.60)",
    fontSize: 11,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },

  recordTimerActive: {
    color: "#FF8A91",
  },

  sendButton: {
    marginTop: 20,
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor:
      "rgba(255,236,179,0.56)",
    shadowColor: GOLD,
    shadowOpacity: 0.20,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 6,
    },
  },

  sendButtonDisabled: {
    opacity: 0.35,
    shadowOpacity: 0,
  },

  sendButtonPressed: {
    opacity: 0.90,
    transform: [{ scale: 0.987 }],
  },

  sendText: {
    color: "#171208",
    fontSize: 14,
    fontWeight: "900",
  },

  pressed: {
    opacity: 0.72,
  },
});
