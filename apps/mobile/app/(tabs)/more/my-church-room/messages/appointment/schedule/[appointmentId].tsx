import React, {
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { sendMessage } from "@/src/lib/messagesStore";

const GOLD = "#D9B35F";

const LOCATION_OPTIONS = [
  {
    id: "video",
    label: "Video call",
    icon: "videocam-outline",
  },
  {
    id: "phone",
    label: "Phone call",
    icon: "call-outline",
  },
  {
    id: "church",
    label: "Church office",
    icon: "business-outline",
  },
  {
    id: "in_person",
    label: "In person",
    icon: "location-outline",
  },
] as const;

function createInitialDate() {
  const value = new Date();

  value.setSeconds(0, 0);

  const currentMinutes =
    value.getMinutes();

  const roundedMinutes =
    Math.ceil(currentMinutes / 5) * 5;

  value.setMinutes(roundedMinutes);

  if (value.getTime() <= Date.now()) {
    value.setHours(
      value.getHours() + 1
    );
  }

  return value;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(
    undefined,
    {
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
    }
  ).format(value);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat(
    undefined,
    {
      hour: "numeric",
      minute: "2-digit",
    }
  ).format(value);
}

export default function AppointmentScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    appointmentId?: string;
    roomId?: string;
    requesterId?: string;
    recipientId?: string;
    requesterName?: string;
  }>();

  const appointmentId = String(
    params.appointmentId || ""
  ).trim();

  const roomId = String(
    params.roomId || ""
  ).trim();

  const requesterId = String(
    params.requesterId || ""
  ).trim();

  const recipientId = String(
    params.recipientId || ""
  ).trim();

  const requesterName =
    String(
      params.requesterName || ""
    ).trim() || "Member";

  const [selectedDateTime, setSelectedDateTime] =
    useState(createInitialDate);

  const [durationMin, setDurationMin] =
    useState(30);

  const [locationId, setLocationId] =
    useState<
      (typeof LOCATION_OPTIONS)[number]["id"]
    >("video");

  const [
    androidPickerMode,
    setAndroidPickerMode,
  ] = useState<
    "date" | "time" | null
  >(null);

  const [sending, setSending] =
    useState(false);

  const selectedLocation =
    LOCATION_OPTIONS.find(
      (option) =>
        option.id === locationId
    ) || LOCATION_OPTIONS[0];

  const dateLabel = useMemo(
    () => formatDate(selectedDateTime),
    [selectedDateTime]
  );

  const timeLabel = useMemo(
    () => formatTime(selectedDateTime),
    [selectedDateTime]
  );

  const canSend =
    !!appointmentId &&
    !!roomId &&
    selectedDateTime.getTime() >
      Date.now() &&
    !sending;

  function updateDate(
    event: DateTimePickerEvent,
    value?: Date
  ) {
    if (Platform.OS === "android") {
      setAndroidPickerMode(null);
    }

    if (
      event.type === "dismissed" ||
      !value
    ) {
      return;
    }

    setSelectedDateTime((current) => {
      const next = new Date(current);

      next.setFullYear(
        value.getFullYear(),
        value.getMonth(),
        value.getDate()
      );

      return next;
    });
  }

  function updateTime(
    event: DateTimePickerEvent,
    value?: Date
  ) {
    if (Platform.OS === "android") {
      setAndroidPickerMode(null);
    }

    if (
      event.type === "dismissed" ||
      !value
    ) {
      return;
    }

    setSelectedDateTime((current) => {
      const next = new Date(current);

      next.setHours(
        value.getHours(),
        value.getMinutes(),
        0,
        0
      );

      return next;
    });
  }

  async function sendSchedule() {
    if (!canSend) {
      if (
        selectedDateTime.getTime() <=
        Date.now()
      ) {
        Alert.alert(
          "Choose a future time",
          "The appointment time must be later than now."
        );
      }

      return;
    }

    const headers: Record<
      string,
      string
    > = {
      ...(getKristoHeaders() as Record<
        string,
        string
      >),
      "Content-Type":
        "application/json",
    };

    const now = Date.now();

    const clientId =
      `appointment_time_${now}_${Math.random()
        .toString(16)
        .slice(2)}`;

    const date = formatDate(
      selectedDateTime
    );

    const time = formatTime(
      selectedDateTime
    );

    const card = {
      type:
        "appointment_time_proposed",
      appointmentId,
      status: "time_proposed",
      requesterId,
      recipientId,
      date,
      time,
      startMs:
        selectedDateTime.getTime(),
      startIso:
        selectedDateTime.toISOString(),
      timezone:
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone || "",
      durationMin,
      location:
        selectedLocation.label,
      locationType:
        selectedLocation.id,
      note: "",
      proposedAt: now,
      createdAt: now,
    };

    setSending(true);

    try {
      const base = String(
        getApiBase() || ""
      ).replace(/\/+$/, "");

      const response = await fetch(
        `${base}/api/church/room-messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            roomId,
            roomKind: "direct",
            kind:
              "appointment_time_proposed",
            text: "",
            attachments: [],
            clientId,
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
              "Could not send the appointment time."
          )
        );
      }

      sendMessage(
        roomId,
        {
          id: String(
            payload?.data?.id ||
              payload?.message?.id ||
              `local_${clientId}`
          ),
          clientId,
          text: "",
          attachments: [],
          createdAt: now,
          senderUserId: recipientId,
          displayName: String(
            headers[
              "x-kristo-user-name"
            ] ||
              headers[
                "x-kristo-display-name"
              ] ||
              "Me"
          ),
          senderRole: String(
            headers[
              "x-kristo-role"
            ] || ""
          ),
          kind:
            "appointment_time_proposed",
          card,
        },
        {
          disableAutoReply: true,
        }
      );

      console.log(
        "KRISTO_APPOINTMENT_TIME_PROPOSED",
        {
          appointmentId,
          startMs:
            selectedDateTime.getTime(),
          durationMin,
          location:
            selectedLocation.label,
        }
      );

      router.back();
    } catch (error: any) {
      Alert.alert(
        "Could not send proposal",
        String(
          error?.message ||
            "Please try again."
        )
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.screen}>
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
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            pressed
              ? styles.pressed
              : null,
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
            Choose meeting time
          </Text>

          <Text
            numberOfLines={1}
            style={styles.headerSub}
          >
            For {requesterName}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(
              insets.bottom + 26,
              40
            ),
          },
        ]}
      >
        <View style={styles.summaryCard}>
          <View
            style={styles.summaryIcon}
          >
            <Ionicons
              name="calendar-outline"
              size={23}
              color={GOLD}
            />
          </View>

          <View style={styles.summaryText}>
            <Text style={styles.summaryDate}>
              {dateLabel}
            </Text>

            <Text style={styles.summaryTime}>
              {timeLabel}
              {"  •  "}
              {durationMin} min
            </Text>
          </View>
        </View>

        <View style={styles.pickerCard}>
          <View style={styles.sectionHeader}>
            <Ionicons
              name="calendar-number-outline"
              size={18}
              color={GOLD}
            />

            <Text style={styles.sectionTitle}>
              Date
            </Text>
          </View>

          {Platform.OS === "ios" ? (
            <DateTimePicker
              value={selectedDateTime}
              mode="date"
              display="spinner"
              minimumDate={new Date()}
              onChange={updateDate}
              textColor="#FFFFFF"
              themeVariant="dark"
              style={styles.iosPicker}
            />
          ) : (
            <Pressable
              onPress={() =>
                setAndroidPickerMode(
                  "date"
                )
              }
              style={({ pressed }) => [
                styles.androidPickerButton,
                pressed
                  ? styles.pressed
                  : null,
              ]}
            >
              <Text
                style={
                  styles.androidPickerValue
                }
              >
                {dateLabel}
              </Text>

              <Ionicons
                name="chevron-forward"
                size={17}
                color="rgba(255,255,255,0.46)"
              />
            </Pressable>
          )}

          <View style={styles.divider} />

          <View style={styles.sectionHeader}>
            <Ionicons
              name="time-outline"
              size={18}
              color={GOLD}
            />

            <Text style={styles.sectionTitle}>
              Time
            </Text>
          </View>

          {Platform.OS === "ios" ? (
            <DateTimePicker
              value={selectedDateTime}
              mode="time"
              display="spinner"
              minuteInterval={5}
              onChange={updateTime}
              textColor="#FFFFFF"
              themeVariant="dark"
              style={styles.iosTimePicker}
            />
          ) : (
            <Pressable
              onPress={() =>
                setAndroidPickerMode(
                  "time"
                )
              }
              style={({ pressed }) => [
                styles.androidPickerButton,
                pressed
                  ? styles.pressed
                  : null,
              ]}
            >
              <Text
                style={
                  styles.androidPickerValue
                }
              >
                {timeLabel}
              </Text>

              <Ionicons
                name="chevron-forward"
                size={17}
                color="rgba(255,255,255,0.46)"
              />
            </Pressable>
          )}
        </View>

        {Platform.OS === "android" &&
        androidPickerMode ===
          "date" ? (
          <DateTimePicker
            value={selectedDateTime}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={updateDate}
          />
        ) : null}

        {Platform.OS === "android" &&
        androidPickerMode ===
          "time" ? (
          <DateTimePicker
            value={selectedDateTime}
            mode="time"
            display="default"
            minuteInterval={5}
            onChange={updateTime}
          />
        ) : null}

        <View style={styles.optionsCard}>
          <Text style={styles.label}>
            Duration
          </Text>

          <View style={styles.durationRow}>
            {[15, 30, 45, 60].map(
              (value) => (
                <Pressable
                  key={value}
                  onPress={() =>
                    setDurationMin(value)
                  }
                  style={({ pressed }) => [
                    styles.durationButton,
                    durationMin === value
                      ? styles.durationButtonActive
                      : null,
                    pressed
                      ? styles.pressed
                      : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.durationText,
                      durationMin === value
                        ? styles.durationTextActive
                        : null,
                    ]}
                  >
                    {value}m
                  </Text>
                </Pressable>
              )
            )}
          </View>

          <Text style={styles.label}>
            Location
          </Text>

          <View style={styles.locationGrid}>
            {LOCATION_OPTIONS.map(
              (option) => {
                const active =
                  locationId === option.id;

                return (
                  <Pressable
                    key={option.id}
                    onPress={() =>
                      setLocationId(
                        option.id
                      )
                    }
                    style={({ pressed }) => [
                      styles.locationButton,
                      active
                        ? styles.locationButtonActive
                        : null,
                      pressed
                        ? styles.pressed
                        : null,
                    ]}
                  >
                    <Ionicons
                      name={
                        option.icon as any
                      }
                      size={18}
                      color={
                        active
                          ? GOLD
                          : "rgba(255,255,255,0.58)"
                      }
                    />

                    <Text
                      numberOfLines={1}
                      style={[
                        styles.locationText,
                        active
                          ? styles.locationTextActive
                          : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              }
            )}
          </View>
        </View>

        <Pressable
          disabled={!canSend}
          onPress={sendSchedule}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend
              ? styles.sendDisabled
              : null,
            pressed && canSend
              ? styles.sendPressed
              : null,
          ]}
        >
          {sending ? (
            <ActivityIndicator
              color="#171208"
            />
          ) : (
            <>
              <Ionicons
                name="send"
                size={18}
                color="#171208"
              />

              <Text style={styles.sendText}>
                Send proposal
              </Text>
            </>
          )}
        </Pressable>

        <Text style={styles.footerHint}>
          The requester must confirm this time.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#080B12",
  },

  header: {
    minHeight: 84,
    paddingHorizontal: 16,
    paddingBottom: 13,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(255,255,255,0.08)",
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },

  headerText: {
    flex: 1,
    marginLeft: 13,
  },

  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },

  headerSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.50)",
    fontSize: 11,
    fontWeight: "700",
  },

  content: {
    padding: 16,
  },

  summaryCard: {
    minHeight: 82,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor:
      "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.30)",
  },

  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.34)",
  },

  summaryText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 13,
  },

  summaryDate: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },

  summaryTime: {
    marginTop: 5,
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },

  pickerCard: {
    marginTop: 14,
    padding: 15,
    borderRadius: 23,
    backgroundColor:
      "rgba(18,22,34,0.97)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.09)",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  sectionTitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "900",
  },

  iosPicker: {
    alignSelf: "stretch",
    height: 156,
    marginTop: 2,
  },

  iosTimePicker: {
    alignSelf: "stretch",
    height: 136,
    marginTop: 2,
  },

  androidPickerButton: {
    marginTop: 11,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent:
      "space-between",
    backgroundColor:
      "rgba(5,8,14,0.78)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },

  androidPickerValue: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },

  divider: {
    height: 1,
    marginVertical: 14,
    backgroundColor:
      "rgba(255,255,255,0.08)",
  },

  optionsCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 23,
    backgroundColor:
      "rgba(18,22,34,0.97)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.09)",
  },

  label: {
    marginBottom: 9,
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "900",
  },

  durationRow: {
    flexDirection: "row",
    gap: 8,
  },

  durationButton: {
    flex: 1,
    minHeight: 43,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.09)",
  },

  durationButtonActive: {
    backgroundColor:
      "rgba(217,179,95,0.16)",
    borderColor:
      "rgba(217,179,95,0.48)",
  },

  durationText: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 12,
    fontWeight: "900",
  },

  durationTextActive: {
    color: GOLD,
  },

  locationGrid: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  locationButton: {
    width: "48.6%",
    minHeight: 48,
    paddingHorizontal: 11,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.09)",
  },

  locationButtonActive: {
    backgroundColor:
      "rgba(217,179,95,0.13)",
    borderColor:
      "rgba(217,179,95,0.42)",
  },

  locationText: {
    flex: 1,
    color: "rgba(255,255,255,0.60)",
    fontSize: 11,
    fontWeight: "800",
  },

  locationTextActive: {
    color: GOLD,
  },

  sendButton: {
    marginTop: 18,
    minHeight: 56,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.20,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 6,
    },
  },

  sendDisabled: {
    opacity: 0.38,
    shadowOpacity: 0,
  },

  sendPressed: {
    opacity: 0.88,
    transform: [
      {
        scale: 0.988,
      },
    ],
  },

  sendText: {
    color: "#171208",
    fontSize: 14,
    fontWeight: "900",
  },

  footerHint: {
    marginTop: 10,
    textAlign: "center",
    color: "rgba(255,255,255,0.38)",
    fontSize: 10,
    fontWeight: "700",
  },

  pressed: {
    opacity: 0.72,
  },
});
