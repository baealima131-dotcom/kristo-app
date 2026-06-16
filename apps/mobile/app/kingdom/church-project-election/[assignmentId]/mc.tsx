import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getChurchProjectMcRuntimeView,
  getChurchProjectMcScheduleState,
  subscribeChurchProjectMcSchedule,
} from "@/src/store/churchProjectMcScheduleStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const SOFT = "rgba(255,255,255,0.68)";
const BLUE = "#6EA8FF";
const EMERALD = "#34D399";

export default function ElectionMcScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    assignmentId?: string;
    title?: string;
    subtitle?: string;
  }>();

  const assignmentId = String(params.assignmentId || "");
  const assignmentTitle = String(params.title || "Assignment Room");
  const assignmentSubtitle = String(params.subtitle || "MC panel");
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectMcSchedule(() => {
      forceRefresh((x) => x + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const scheduleState = getChurchProjectMcScheduleState(assignmentId);
  const runtime = useMemo(
    () => getChurchProjectMcRuntimeView(assignmentId),
    [assignmentId, scheduleState.items, scheduleState.sentToMc]
  );

  const liveMc = runtime.current;
  const nextMc = runtime.next;
  const runtimeItems = runtime.items || [];
  const runtimeTitle = runtime.eventTitle || assignmentTitle;
  const runtimeDateLabel = runtime.eventDateLabel || "Not set";
  const runtimeStartsAt = runtime.liveStartsAt || "--";

  function openSection(kind: "team" | "schedule" | "chat" | "important") {
    router.push(
      `/kingdom/church-project-election/${assignmentId}/${kind}?title=${encodeURIComponent(
        assignmentTitle
      )}&subtitle=${encodeURIComponent(assignmentSubtitle)}` as any
    );
  }

  function openLiveRoom() {
    router.push({
      pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
      params: {
        title: assignmentTitle,
        role: "Host",
        assignmentId,
      },
    });
  }

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.iconBtn, pressed ? s.pressed : null]}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={s.topText}>
          <Text style={s.topTitle} numberOfLines={1}>MC Panel</Text>
          <Text style={s.topSub} numberOfLines={1}>{assignmentTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.heroTopRow}>
            <View style={s.heroIcon}>
              <Ionicons name="tv-outline" size={24} color={GOLD} />
            </View>

            <View style={s.livePill}>
              <View style={s.liveDot} />
              <Text style={s.livePillText}>{scheduleState.sentToMc ? "MC READY" : "PLANNING"}</Text>
            </View>
          </View>

          <Text style={s.heroKicker}>MC LIVE SCREEN</Text>
          <Text style={s.heroTitle}>{assignmentTitle}</Text>
          <Text style={s.heroSub}>
            Hapa ni screen kubwa ya kuonyesha MC kinachoendelea sasa. Meeting na schedule vikishasukwa,
            MC anaona event title, siku, saa ya kuanza, na running order bila kuchanganya page.
          </Text>

          <View style={s.screenBox}>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>EVENT</Text>
              <Text style={s.screenValue}>{runtimeTitle}</Text>
            </View>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>DAY</Text>
              <Text style={s.screenValue}>{runtimeDateLabel}</Text>
            </View>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>LIVE STARTS</Text>
              <Text style={s.screenValue}>{runtimeStartsAt}</Text>
            </View>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>LIVE NOW</Text>
              <Text style={s.screenValue}>{liveMc.name}</Text>
            </View>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>CURRENT TASK</Text>
              <Text style={s.screenValue}>{liveMc.task}</Text>
            </View>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>NEXT MC</Text>
              <Text style={s.screenValue}>{nextMc.name}</Text>
            </View>
            <View style={s.screenRow}>
              <Text style={s.screenLabel}>NEXT SLOT</Text>
              <Text style={s.screenValue}>{nextMc.startTime} - {nextMc.endTime}</Text>
            </View>
            <View style={s.screenRowLast}>
              <Text style={s.screenLabel}>TOTAL SLOTS</Text>
              <Text style={s.screenValue}>{runtimeItems.length}</Text>
            </View>
          </View>
        </View>

        <Pressable onPress={() => openSection("team")} style={({ pressed }) => [s.boxCard, pressed ? s.pressed : null]}>
          <View style={s.boxHead}>
            <View>
              <Text style={s.boxLabel}>MC LIST</Text>
              <Text style={s.boxTitle}>List ya ma MC</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT} />
          </View>
          <Text style={s.boxSub}>
            Waone wote kwenye box yao. Ukibonyeza unaingia kwenye taarifa zao kwa mpangilio safi.
          </Text>
        </Pressable>

        <Pressable onPress={() => openSection("schedule")} style={({ pressed }) => [s.boxCard, pressed ? s.pressed : null]}>
          <View style={s.boxHead}>
            <View>
              <Text style={s.boxLabel}>MY SCHEDULE</Text>
              <Text style={s.boxTitle}>Ratiba ya event live</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT} />
          </View>
          <Text style={s.boxSub}>
            Meeting / event plan ikishasukumwa kwenye schedule, MC anaipokea hapa ikiwa wazi,
            imepangwa kwa time, na slot count yake ni {runtimeItems.length}.
          </Text>
        </Pressable>

        <Pressable onPress={() => openSection("chat")} style={({ pressed }) => [s.boxCard, pressed ? s.pressed : null]}>
          <View style={s.boxHead}>
            <View>
              <Text style={s.boxLabel}>CHAT BOX</Text>
              <Text style={s.boxTitle}>Coordination ya ma MC</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT} />
          </View>
          <Text style={s.boxSub}>
            Kila MC ana box yake ya chat. Hakuna kuchanganya kila kitu kwenye scroll moja.
          </Text>
        </Pressable>

        <Pressable onPress={() => openSection("important")} style={({ pressed }) => [s.boxCard, pressed ? s.pressed : null]}>
          <View style={s.boxHead}>
            <View>
              <Text style={s.boxLabel}>IMPORTANT</Text>
              <Text style={s.boxTitle}>Vitu vya muhimu</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT} />
          </View>
          <Text style={s.boxSub}>
            Hapa ndipo unaona live handoff, aliye live sasa, anayefuata, na alerts za muhimu.
          </Text>
        </Pressable>

        <View style={s.runtimeCard}>
          <Text style={s.runtimeLabel}>MC RUNTIME STATUS</Text>
          <Text style={s.runtimeTitle}>
            {scheduleState.sentToMc ? "Schedule received from Meeting/Schedule" : "Waiting for Schedule push"}
          </Text>
          <Text style={s.runtimeSub}>
            Start {runtimeStartsAt} • {runtimeDateLabel} • {runtimeItems.length} slots
          </Text>
        </View>

        <Pressable onPress={openLiveRoom} style={({ pressed }) => [s.primaryBtn, pressed ? s.pressed : null]}>
          <Ionicons name="videocam-outline" size={18} color={BG} />
          <Text style={s.primaryBtnText}>Open live with MC schedule</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 58,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: 12,
  },
  pressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  topText: { flex: 1, minWidth: 0 },
  topTitle: { color: TEXT, fontSize: 17, fontWeight: "800" },
  topSub: { color: SOFT, fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  hero: {
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(52,211,153,0.10)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.22)",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: EMERALD,
  },
  livePillText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
  },
  heroKicker: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "900",
    marginTop: 8,
  },
  heroSub: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  screenBox: {
    marginTop: 16,
    borderRadius: 22,
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.24)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  screenRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  screenRowLast: {
    paddingTop: 10,
  },
  screenLabel: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  screenValue: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 5,
  },

  boxCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 22,
    padding: 16,
  },
  boxHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  boxLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  boxTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 8,
  },
  boxSub: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },

  runtimeCard: {
    backgroundColor: "rgba(52,211,153,0.08)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.18)",
    borderRadius: 22,
    padding: 16,
  },
  runtimeLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  runtimeTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 8,
  },
  runtimeSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },

  primaryBtn: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    color: BG,
    fontSize: 15,
    fontWeight: "900",
  },
});
