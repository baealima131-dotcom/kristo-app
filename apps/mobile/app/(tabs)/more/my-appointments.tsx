import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Stack,
  useRouter,
} from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getSnapshot,
  subscribe,
} from "@/src/lib/messagesStore";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  buildAppointmentHubItems,
  type AppointmentHubItem,
  type AppointmentHubSection,
} from "@/src/lib/appointmentHub";

const BG = "#090D15";
const GOLD = "#D9B35F";


type AppointmentFilter =
  | "all"
  | "accepted"
  | "pending"
  | "cancelled"
  | "rejected";

const FILTERS: AppointmentFilter[] = [
  "all",
  "accepted",
  "pending",
  "cancelled",
  "rejected",
];


const SECTION_CONFIG: Array<{
  key: AppointmentHubSection;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<
    typeof Ionicons
  >["name"];
  accent: string;
}> = [
  {
    key: "needs_action",
    title: "Needs Action",
    subtitle:
      "Appointments waiting for your response",
    icon: "alert-circle-outline",
    accent: "#F5BE41",
  },
  {
    key: "upcoming",
    title: "Upcoming",
    subtitle:
      "Confirmed appointments ahead",
    icon: "calendar-outline",
    accent: "#4ADE80",
  },
  {
    key: "negotiation",
    title: "In Progress",
    subtitle:
      "Accepted, proposed, or negotiating",
    icon: "swap-horizontal-outline",
    accent: "#A78BFA",
  },
  {
    key: "past",
    title: "Past",
    subtitle:
      "Appointments whose time has passed",
    icon: "time-outline",
    accent: "#94A3B8",
  },
  {
    key: "rejected",
    title: "Rejected & Cancelled",
    subtitle:
      "Closed appointment requests",
    icon: "close-circle-outline",
    accent: "#FF6B72",
  },
];

function statusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pending";
    case "accepted":
    case "accepted_awaiting_time":
      return "Accepted";
    case "time_proposed":
      return "Time proposed";
    case "reschedule_requested":
      return "Negotiation";
    case "confirmed":
      return "Confirmed";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    case "deleted":
      return "Deleted";
    default:
      return status || "Appointment";
  }
}

function initialOf(name: string) {
  return (
    String(name || "M")
      .trim()
      .charAt(0)
      .toUpperCase() || "M"
  );
}

function AppointmentCard({
  item,
  accent,
  onPress,
}: {
  item: AppointmentHubItem;
  accent: string;
  onPress: () => void;
}) {
  const meta = [
    item.date,
    item.time,
    item.durationMin
      ? `${
          item.durationMin === 61
            ? "60+"
            : item.durationMin
        } min`
      : "",
  ].filter(Boolean);

  const place = [
    item.location,
    item.address,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: `${accent}55`,
          opacity: pressed ? 0.78 : 1,
          transform: [
            {
              scale: pressed ? 0.99 : 1,
            },
          ],
        },
      ]}
    >
      <View style={styles.cardTop}>
        {item.otherAvatarUri ? (
          <Image
            source={{
              uri: item.otherAvatarUri,
            }}
            style={styles.avatar}
          />
        ) : (
          <View
            style={[
              styles.avatarFallback,
              {
                borderColor: `${accent}66`,
                backgroundColor:
                  `${accent}18`,
              },
            ]}
          >
            <Text
              style={[
                styles.avatarInitial,
                {
                  color: accent,
                },
              ]}
            >
              {initialOf(item.otherName)}
            </Text>
          </View>
        )}

        <View style={styles.cardIdentity}>
          <Text
            numberOfLines={1}
            style={styles.personName}
          >
            {item.otherName ||
              item.threadTitle ||
              "Member"}
          </Text>

          <Text
            numberOfLines={1}
            style={styles.threadLabel}
          >
            {item.threadTitle}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            {
              borderColor: `${accent}66`,
              backgroundColor:
                `${accent}18`,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color: accent,
              },
            ]}
          >
            {statusLabel(item.status)}
          </Text>
        </View>
      </View>

      {item.message ? (
        <Text
          numberOfLines={2}
          style={styles.message}
        >
          {item.message}
        </Text>
      ) : null}

      {meta.length ? (
        <View style={styles.metaRow}>
          <Ionicons
            name="calendar-outline"
            size={15}
            color={accent}
          />

          <Text style={styles.metaText}>
            {meta.join("  •  ")}
          </Text>
        </View>
      ) : null}

      {place.length ? (
        <View style={styles.metaRow}>
          <Ionicons
            name="location-outline"
            size={15}
            color={accent}
          />

          <Text
            numberOfLines={2}
            style={styles.metaText}
          >
            {place.join(" • ")}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <Text
          style={[
            styles.actionText,
            {
              color: accent,
            },
          ]}
        >
          {item.actionLabel}
        </Text>

        <Ionicons
          name="chevron-forward"
          size={18}
          color={accent}
        />
      </View>
    </Pressable>
  );
}

export default function MyAppointmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const currentUserId = String(
    session?.userId || ""
  ).trim();

  const [, force] = useState(0);
  const [selectedFilter, setSelectedFilter] =
    useState<AppointmentFilter>("all");

  useEffect(() => {
    return subscribe(() => {
      force((value) => value + 1);
    });
  }, []);

  const snapshot = getSnapshot();

  const items = useMemo(
    () =>
      buildAppointmentHubItems(
        snapshot,
        currentUserId
      ),
    [
      snapshot,
      currentUserId,
    ]
  );

  const needsActionCount = items.filter(
    (item) => item.needsAction
  ).length;

  const filteredItems = useMemo(() => {
    switch (selectedFilter) {
      case "accepted":
        return items.filter(i => i.status === "confirmed");

      case "pending":
        return items.filter(i =>
          [
            "pending",
            "accepted",
            "accepted_awaiting_time",
            "time_proposed",
            "reschedule_requested",
          ].includes(i.status)
        );

      case "cancelled":
        return items.filter(i =>
          i.status === "cancelled" ||
          i.status === "deleted"
        );

      case "rejected":
        return items.filter(i => i.status === "rejected");

      default:
        return items;
    }
  }, [items, selectedFilter]);

  const filterCounts = {
    all: items.length,
    accepted: items.filter(i=>i.status==="confirmed").length,
    pending: items.filter(i=>[
      "pending",
      "accepted",
      "accepted_awaiting_time",
      "time_proposed",
      "reschedule_requested",
    ].includes(i.status)).length,
    cancelled: items.filter(i =>
      i.status === "cancelled" ||
      i.status === "deleted"
    ).length,
    rejected: items.filter(i=>i.status==="rejected").length,
  };

  function openAppointment(
    item: AppointmentHubItem
  ) {
    router.push({
      pathname:
        "/(tabs)/more/my-church-room/messages/[id]",
      params: {
        id: item.threadId,
        threadId: item.threadId,
        roomId: item.threadId,
        title:
          item.threadTitle ||
          item.otherName,
        sub:
          item.threadSub ||
          "Appointment conversation",
        roomKind: "direct",
        source: "my-appointments",
      },
    } as any);
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 10,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backButton,
            pressed
              ? styles.pressed
              : null,
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={23}
            color="#FFFFFF"
          />
        </Pressable>

        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>
            TLMC MY WAY • X
          </Text>

          <Text style={styles.title}>
            My Appointments
          </Text>

          <Text style={styles.subtitle}>
            All your appointment requests in
            one place
          </Text>
        </View>

        <View
          style={[
            styles.headerBadge,
            needsActionCount > 0
              ? styles.headerBadgeActive
              : null,
          ]}
        >
          <Text
            style={[
              styles.headerBadgeText,
              needsActionCount > 0
                ? styles.headerBadgeTextActive
                : null,
            ]}
          >
            {needsActionCount}
          </Text>

          <Text
            style={[
              styles.headerBadgeLabel,
              needsActionCount > 0
                ? styles.headerBadgeTextActive
                : null,
            ]}
          >
            action
          </Text>
        </View>
      </View>


      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(i)=>i}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal:16,
          paddingBottom:14,
        }}
        renderItem={({item})=>{
          const active=item===selectedFilter;
          return(
            <Pressable
              onPress={()=>setSelectedFilter(item)}
              style={{
                marginRight:10,
                paddingHorizontal:16,
                height:38,
                borderRadius:19,
                alignItems:"center",
                justifyContent:"center",
                backgroundColor:active?GOLD:"#171D29",
                borderWidth:1,
                borderColor:active?GOLD:"rgba(255,255,255,.10)",
              }}>
              <Text
                style={{
                  fontWeight:"900",
                  color:active?"#111827":"white",
                  textTransform:"capitalize",
                }}>
                {item} ({filterCounts[item]})
              </Text>
            </Pressable>
          );
        }}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 15,
          paddingBottom:
            Math.max(
              insets.bottom + 36,
              60
            ),
        }}
      >
        {!items.length ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="calendar-outline"
                size={31}
                color={GOLD}
              />
            </View>

            <Text style={styles.emptyTitle}>
              No appointments yet
            </Text>

            <Text style={styles.emptyText}>
              Appointment requests from your
              conversations will appear here.
            </Text>
          </View>
        ) : null}

        {SECTION_CONFIG.map(
          (section) => {
            const sectionItems =
              filteredItems
                .filter(
                  (item) =>
                    item.section ===
                    section.key
                )
                .sort((a, b) => {
                  if (
                    section.key === "upcoming" ||
                    section.key === "negotiation" ||
                    section.key === "needs_action"
                  ) {
                    const aTime =
                      a.startsAtMs > 0
                        ? a.startsAtMs
                        : Number.MAX_SAFE_INTEGER;

                    const bTime =
                      b.startsAtMs > 0
                        ? b.startsAtMs
                        : Number.MAX_SAFE_INTEGER;

                    if (aTime !== bTime) {
                      return aTime - bTime;
                    }
                  }

                  if (section.key === "past") {
                    const aTime =
                      a.startsAtMs || 0;

                    const bTime =
                      b.startsAtMs || 0;

                    if (aTime !== bTime) {
                      return bTime - aTime;
                    }
                  }

                  return b.updatedAt - a.updatedAt;
                });

            if (!sectionItems.length) {
              return null;
            }

            return (
              <View
                key={section.key}
                style={styles.section}
              >
                <View
                  style={styles.sectionHeader}
                >
                  <View
                    style={[
                      styles.sectionIcon,
                      {
                        borderColor:
                          `${section.accent}55`,
                        backgroundColor:
                          `${section.accent}14`,
                      },
                    ]}
                  >
                    <Ionicons
                      name={section.icon}
                      size={18}
                      color={section.accent}
                    />
                  </View>

                  <View
                    style={styles.sectionCopy}
                  >
                    <Text
                      style={
                        styles.sectionTitle
                      }
                    >
                      {section.title}
                    </Text>

                    <Text
                      style={
                        styles.sectionSubtitle
                      }
                    >
                      {section.subtitle}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.countPill,
                      {
                        borderColor:
                          `${section.accent}50`,
                        backgroundColor:
                          `${section.accent}12`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.countText,
                        {
                          color:
                            section.accent,
                        },
                      ]}
                    >
                      {sectionItems.length}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardList}>
                  {sectionItems.map(
                    (item) => (
                      <AppointmentCard
                        key={
                          item.appointmentId
                        }
                        item={item}
                        accent={
                          section.accent
                        }
                        onPress={() =>
                          openAppointment(
                            item
                          )
                        }
                      />
                    )
                  )}
                </View>
              </View>
            );
          }
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#101521",
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(217,179,95,0.15)",
  },

  backButton: {
    width: 43,
    height: 43,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.09)",
  },

  headerCopy: {
    flex: 1,
    minWidth: 0,
  },

  eyebrow: {
    color:
      "rgba(217,179,95,0.78)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.15,
  },

  title: {
    marginTop: 3,
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
  },

  subtitle: {
    marginTop: 3,
    color:
      "rgba(255,255,255,0.44)",
    fontSize: 10,
    fontWeight: "700",
  },

  headerBadge: {
    minWidth: 50,
    height: 50,
    paddingHorizontal: 8,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
  },

  headerBadgeActive: {
    backgroundColor:
      "rgba(245,190,65,0.12)",
    borderColor:
      "rgba(245,190,65,0.38)",
  },

  headerBadgeText: {
    color:
      "rgba(255,255,255,0.56)",
    fontSize: 15,
    fontWeight: "900",
  },

  headerBadgeTextActive: {
    color: "#F5BE41",
  },

  headerBadgeLabel: {
    marginTop: 1,
    color:
      "rgba(255,255,255,0.34)",
    fontSize: 7.5,
    fontWeight: "900",
    textTransform: "uppercase",
  },

  emptyCard: {
    marginTop: 36,
    paddingHorizontal: 24,
    paddingVertical: 34,
    borderRadius: 25,
    alignItems: "center",
    backgroundColor:
      "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.16)",
  },

  emptyIcon: {
    width: 65,
    height: 65,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.25)",
  },

  emptyTitle: {
    marginTop: 17,
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },

  emptyText: {
    marginTop: 7,
    color:
      "rgba(255,255,255,0.46)",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "center",
  },

  section: {
    marginBottom: 27,
  },

  sectionHeader: {
    marginBottom: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  sectionIcon: {
    width: 39,
    height: 39,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  sectionCopy: {
    flex: 1,
    minWidth: 0,
  },

  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  sectionSubtitle: {
    marginTop: 2,
    color:
      "rgba(255,255,255,0.38)",
    fontSize: 9,
    fontWeight: "700",
  },

  countPill: {
    minWidth: 31,
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  countText: {
    fontSize: 11,
    fontWeight: "900",
  },

  cardList: {
    gap: 10,
  },

  card: {
    padding: 15,
    borderRadius: 21,
    backgroundColor:
      "rgba(19,24,36,0.97)",
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 7,
    },
  },

  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  avatar: {
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor:
      "rgba(255,255,255,0.06)",
  },

  avatarFallback: {
    width: 45,
    height: 45,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  avatarInitial: {
    fontSize: 17,
    fontWeight: "900",
  },

  cardIdentity: {
    flex: 1,
    minWidth: 0,
  },

  personName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  threadLabel: {
    marginTop: 3,
    color:
      "rgba(255,255,255,0.39)",
    fontSize: 9,
    fontWeight: "700",
  },

  statusPill: {
    paddingHorizontal: 9,
    minHeight: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  statusText: {
    fontSize: 8.5,
    fontWeight: "900",
    textTransform: "uppercase",
  },

  message: {
    marginTop: 13,
    color:
      "rgba(255,255,255,0.74)",
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: "700",
  },

  metaRow: {
    marginTop: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  metaText: {
    flex: 1,
    color:
      "rgba(255,255,255,0.61)",
    fontSize: 10.5,
    lineHeight: 16,
    fontWeight: "800",
  },

  cardFooter: {
    marginTop: 14,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor:
      "rgba(255,255,255,0.065)",
  },

  actionText: {
    fontSize: 10.5,
    fontWeight: "900",
  },

  pressed: {
    opacity: 0.72,
  },
});
