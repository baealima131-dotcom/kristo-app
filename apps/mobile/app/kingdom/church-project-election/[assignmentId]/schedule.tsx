import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, Alert, Keyboard, KeyboardAvoidingView, Platform, TouchableWithoutFeedback } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getChurchProjectMcRuntimeView,
  getParticipantPoolForProgram,
  rebuildScheduleTimeline,
  saveChurchProjectMcSchedule,
  subscribeChurchProjectMcSchedule,
} from "@/src/store/churchProjectMcScheduleStore";
import { getSnapshot, sendAssignmentCards } from "@/src/lib/messagesStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const SOFT = "rgba(255,255,255,0.68)";
const SOFTER = "rgba(255,255,255,0.50)";
const EMERALD = "#34D399";
const CYAN = "#38BDF8";
const VIOLET = "#A78BFA";
const AMBER = "#F59E0B";
const ORANGE = "#FB923C";
const ROSE = "#F472B6";

function getProgramTone(name: string) {
  const key = String(name || "").trim().toLowerCase();
  if (key === "mc") {
    return {
      solid: GOLD,
      text: GOLD,
      softBg: "rgba(217,179,95,0.12)",
      softBorder: "rgba(217,179,95,0.30)",
      pillBg: "rgba(217,179,95,0.14)",
      pillBorder: "rgba(217,179,95,0.30)",
      pillIcon: GOLD,
      sectionLabel: GOLD,
      notes: EMERALD,
      editBg: "rgba(217,179,95,0.10)",
      editBorder: "rgba(217,179,95,0.22)",
    };
  }
  if (key === "prayer") {
    return {
      solid: EMERALD,
      text: EMERALD,
      softBg: "rgba(52,211,153,0.12)",
      softBorder: "rgba(52,211,153,0.28)",
      pillBg: "rgba(52,211,153,0.12)",
      pillBorder: "rgba(52,211,153,0.25)",
      pillIcon: EMERALD,
      sectionLabel: EMERALD,
      notes: EMERALD,
      editBg: "rgba(52,211,153,0.10)",
      editBorder: "rgba(52,211,153,0.20)",
    };
  }
  if (key === "guests") {
    return {
      solid: CYAN,
      text: CYAN,
      softBg: "rgba(56,189,248,0.12)",
      softBorder: "rgba(56,189,248,0.26)",
      pillBg: "rgba(56,189,248,0.12)",
      pillBorder: "rgba(56,189,248,0.24)",
      pillIcon: CYAN,
      sectionLabel: CYAN,
      notes: CYAN,
      editBg: "rgba(56,189,248,0.10)",
      editBorder: "rgba(56,189,248,0.18)",
    };
  }
  if (key === "choir") {
    return {
      solid: VIOLET,
      text: VIOLET,
      softBg: "rgba(167,139,250,0.12)",
      softBorder: "rgba(167,139,250,0.25)",
      pillBg: "rgba(167,139,250,0.12)",
      pillBorder: "rgba(167,139,250,0.24)",
      pillIcon: VIOLET,
      sectionLabel: VIOLET,
      notes: VIOLET,
      editBg: "rgba(167,139,250,0.10)",
      editBorder: "rgba(167,139,250,0.18)",
    };
  }
  if (key === "testimony") {
    return {
      solid: AMBER,
      text: AMBER,
      softBg: "rgba(245,158,11,0.12)",
      softBorder: "rgba(245,158,11,0.26)",
      pillBg: "rgba(245,158,11,0.12)",
      pillBorder: "rgba(245,158,11,0.24)",
      pillIcon: AMBER,
      sectionLabel: AMBER,
      notes: AMBER,
      editBg: "rgba(245,158,11,0.10)",
      editBorder: "rgba(245,158,11,0.18)",
    };
  }
  if (key === "offering") {
    return {
      solid: ORANGE,
      text: ORANGE,
      softBg: "rgba(251,146,60,0.12)",
      softBorder: "rgba(251,146,60,0.26)",
      pillBg: "rgba(251,146,60,0.12)",
      pillBorder: "rgba(251,146,60,0.24)",
      pillIcon: ORANGE,
      sectionLabel: ORANGE,
      notes: ORANGE,
      editBg: "rgba(251,146,60,0.10)",
      editBorder: "rgba(251,146,60,0.18)",
    };
  }
  if (key === "announcements") {
    return {
      solid: ROSE,
      text: ROSE,
      softBg: "rgba(244,114,182,0.12)",
      softBorder: "rgba(244,114,182,0.26)",
      pillBg: "rgba(244,114,182,0.12)",
      pillBorder: "rgba(244,114,182,0.24)",
      pillIcon: ROSE,
      sectionLabel: ROSE,
      notes: ROSE,
      editBg: "rgba(244,114,182,0.10)",
      editBorder: "rgba(244,114,182,0.18)",
    };
  }
  return {
    solid: TEXT,
    text: TEXT,
    softBg: "rgba(255,255,255,0.05)",
    softBorder: "rgba(255,255,255,0.10)",
    pillBg: "rgba(255,255,255,0.05)",
    pillBorder: "rgba(255,255,255,0.12)",
    pillIcon: TEXT,
    sectionLabel: GOLD,
    notes: EMERALD,
    editBg: "rgba(255,255,255,0.05)",
    editBorder: "rgba(255,255,255,0.10)",
  };
}

function cleanRole(role: string, durationMin: number) {
  const safe = String(role || "").trim();
  if (!safe) return "";
  return safe
    .replace(new RegExp(`\\s*•\\s*${durationMin}\\s*min\\s*$`, "i"), "")
    .replace(/\s*•\s*\d+\s*min\s*$/i, "")
    .trim();
}

function getEditParticipantLabel(programName: string) {
  const key = String(programName || "").trim().toLowerCase();

  if (key === "mc") return "Participant / person";
  if (key === "prayer") return "Leader / pastor";
  if (key === "choir") return "Choir group";
  if (key === "testimony") return "Selected people";
  if (key === "announcements") return "Announcer / MC";
  if (key === "offering") return "Treasury / ushers";
  if (key === "guests") return "Guest / protocol";

  return "Participant";
}

function getAssignmentRoleKey(programName: string, roleLabel: string) {
  const safeProgram = String(programName || "").trim().toLowerCase();
  const safeRole = String(roleLabel || "").trim().toLowerCase();

  if (safeRole.includes("pastor") || safeRole.includes("leader")) return "leader";
  if (safeRole.includes("mc") || safeProgram.includes("mc")) return "mc";
  if (safeRole.includes("choir") || safeProgram.includes("choir")) return "choir";
  if (
    safeRole.includes("guest") ||
    safeRole.includes("protocol") ||
    safeProgram.includes("guest")
  ) return "protocol";

  return "member";
}

function buildAssignmentNotes(item: any, roleLabel: string) {
  const baseNotes = Array.isArray(item?.chat)
    ? item.chat.map((x: any) => String(x || "").trim()).filter(Boolean)
    : [];

  const fallback = [
    roleLabel ? `Audience: ${roleLabel.toLowerCase()}` : "Audience: assigned people",
    "Claim only if your role matches",
  ];

  const normalizedNotes = (baseNotes.length ? baseNotes : fallback).filter(
    (note: string) => !/^Meeting day\s*:/i.test(String(note || "").trim())
  );

  const iso = String(item?.meetingDate || "").trim();
  const meetingDayLabel = iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      })
    : String(item?.meetingDay || "").trim();

  if (meetingDayLabel) {
    const audienceIndex = normalizedNotes.findIndex((note: string) =>
      /^Audience\s*:/i.test(String(note || "").trim())
    );

    if (audienceIndex >= 0) {
      normalizedNotes.splice(audienceIndex + 1, 0, `Meeting day: ${meetingDayLabel}`);
    } else {
      normalizedNotes.unshift(`Meeting day: ${meetingDayLabel}`);
    }
  }

  return normalizedNotes;
}

function getFlowBadge(name: string) {
  const key = String(name || "").trim().toLowerCase();

  if (!key) return "";
  if (key.includes("opening prayer")) return "OPENING PRAYER";
  if (key.includes("closing prayer")) return "CLOSING PRAYER";
  if (key.includes("closing offering")) return "CLOSING OFFERING";
  if (key.includes("final announcements")) return "FINAL ANNOUNCEMENTS";
  if (key.includes(" opening")) return "OPENING";
  if (key.includes(" middle")) return "MIDDLE";
  if (key.includes(" closing")) return "CLOSING";

  return "";
}

function getFlowBadgeTone(name: string) {
  const key = String(name || "").trim().toLowerCase();

  if (key.includes("opening prayer")) {
    return {
      text: EMERALD,
      bg: "rgba(52,211,153,0.14)",
      border: "rgba(52,211,153,0.28)",
      cardBg: "rgba(52,211,153,0.07)",
      cardBorder: "rgba(52,211,153,0.18)",
    };
  }

  if (key.includes("closing prayer")) {
    return {
      text: EMERALD,
      bg: "rgba(52,211,153,0.14)",
      border: "rgba(52,211,153,0.28)",
      cardBg: "rgba(52,211,153,0.06)",
      cardBorder: "rgba(52,211,153,0.18)",
    };
  }

  if (key.includes("closing offering")) {
    return {
      text: ORANGE,
      bg: "rgba(251,146,60,0.14)",
      border: "rgba(251,146,60,0.28)",
      cardBg: "rgba(251,146,60,0.06)",
      cardBorder: "rgba(251,146,60,0.18)",
    };
  }

  if (key.includes("final announcements")) {
    return {
      text: ROSE,
      bg: "rgba(244,114,182,0.14)",
      border: "rgba(244,114,182,0.28)",
      cardBg: "rgba(244,114,182,0.06)",
      cardBorder: "rgba(244,114,182,0.18)",
    };
  }

  if (key.includes(" opening")) {
    return {
      text: GOLD,
      bg: "rgba(217,179,95,0.14)",
      border: "rgba(217,179,95,0.28)",
      cardBg: "rgba(217,179,95,0.06)",
      cardBorder: "rgba(217,179,95,0.18)",
    };
  }

  if (key.includes(" middle")) {
    return {
      text: CYAN,
      bg: "rgba(56,189,248,0.12)",
      border: "rgba(56,189,248,0.24)",
      cardBg: "rgba(56,189,248,0.05)",
      cardBorder: "rgba(56,189,248,0.16)",
    };
  }

  if (key.includes(" closing")) {
    return {
      text: GOLD,
      bg: "rgba(217,179,95,0.14)",
      border: "rgba(217,179,95,0.28)",
      cardBg: "rgba(217,179,95,0.06)",
      cardBorder: "rgba(217,179,95,0.18)",
    };
  }

  return null;
}

export default function ChurchProjectMcScheduleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    assignmentId?: string;
    title?: string;
    subtitle?: string;
  }>();

  const assignmentId = String(params.assignmentId || "");
  const assignmentTitle = String(params.title || "Assignment Room");
  const [refreshTick, forceRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectMcSchedule(() => {
      forceRefresh((x) => x + 1);
    });
    return unsubscribe;
  }, []);

  const runtime = useMemo(
    () => getChurchProjectMcRuntimeView(assignmentId),
    [assignmentId, refreshTick]
  );

  const items = runtime.items || [];

  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editParticipants, setEditParticipants] = useState<string[]>([]);
  const [editDuration, setEditDuration] = useState("");
  const [editTask, setEditTask] = useState("");
  const [assignmentCardsSentTick, setAssignmentCardsSentTick] = useState(0);
  

  const getProgramBaseName = (name: string) =>
    String(name || "")
      .replace(/\s+Part\s+\d+\/\d+\s*$/i, "")
      .trim();

  const getProgramKey = (name: string) =>
    getProgramBaseName(name)
      .toLowerCase()
      .replace(/\s+/g, "-");

  const groupedPrograms = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        title: string;
        rows: Array<{
          slotNumber: number;
          startTime: string;
          endTime: string;
          durationMin: number;
          role: string;
          task: string;
        }>;
      }
    >();

    items.forEach((item, index) => {
      const key = getProgramKey(item.name);
      const baseTitle = getProgramBaseName(item.name);

      if (!map.has(key)) {
        map.set(key, {
          key,
          title: baseTitle,
          rows: [],
        });
      }

      map.get(key)!.rows.push({
        slotNumber: index + 1,
        startTime: item.startTime,
        endTime: item.endTime,
        durationMin: item.durationMin,
        role: item.role,
        task: item.task,
      });
    });

    return Array.from(map.values());
  }, [items]);

  const [selectedProgramKey, setSelectedProgramKey] = useState("");

  const allProgramsGroup = {
    key: "all",
    title: "ALL",
    rows: items.map((item, index) => ({
      key: item.id,
      title: item.name,
      slotNumber: index + 1,
      time: `${item.startTime} - ${item.endTime}`,
      meta: `${item.durationMin} min • ${cleanRole(item.role, item.durationMin) || item.name}`,
    })),
  };

  const programTabs = groupedPrograms.length
    ? [allProgramsGroup, ...groupedPrograms]
    : [];

  useEffect(() => {
    if (!programTabs.length) {
      if (selectedProgramKey !== "") setSelectedProgramKey("");
      return;
    }

    const exists = programTabs.some((group) => group.key === selectedProgramKey);
    if (!exists) {
      setSelectedProgramKey(programTabs[0].key);
    }
  }, [programTabs, selectedProgramKey]);

  const selectedProgram =
    programTabs.find((group) => group.key === selectedProgramKey) ||
    programTabs[0] ||
    null;

  const selectedProgramTone = getProgramTone(selectedProgram?.title || "");

  const getItemProgramKey = (name: string) => {
    const raw = getProgramBaseName(name).toLowerCase();
    if (!raw) return "";
    return raw.replace(/\s+/g, "-");
  };

  function parseParticipants(value: string) {
    return String(value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function joinParticipants(values: string[]) {
    return values.filter(Boolean).join(", ");
  }
  function toggleParticipantOption(option: string) {
    setEditParticipants((prev) => {
      if (prev.includes(option)) {
        return prev.filter((x) => x !== option);
      }
      return [...prev, option];
    });
  }

  const visibleItems =
    selectedProgram && selectedProgram.key !== "all"
      ? items.filter((item) => getItemProgramKey(item.name) === selectedProgram.key)
      : items;

  const groupedVisibleSections = useMemo(
    () => groupByFlowZone(visibleItems),
    [visibleItems]
  );

  const participantOptions = useMemo(
    () => getParticipantPoolForProgram(assignmentId, editName),
    [assignmentId, editName, forceRefresh]
  );

  const assignmentCardsAlreadySent = useMemo(() => {
    const snap = getSnapshot();
    const threadMessages = Array.isArray((snap as any)?.messages?.[assignmentId])
      ? (snap as any).messages[assignmentId]
      : [];

    return threadMessages.some((m: any) => m?.kind === "assignment_card");
  }, [assignmentId, assignmentCardsSentTick]);

  function handleSendToAssignmentRoom() {
    if (!assignmentId) {
      Alert.alert("Missing room", "Assignment room id haijapatikana.");
      return;
    }

    if (!items.length) {
      Alert.alert("No schedule", "Hakuna rounds za kutuma kwenye assignment room.");
      return;
    }

    if (assignmentCardsAlreadySent) {
      Alert.alert("Already sent", "Assignment cards tayari zimeshatumwa kwenye room hii.");
      return;
    }

    const cards = items.map((item: any, index: number) => {
      const roleLabel =
        cleanRole(item?.role || "", Number(item?.durationMin || 0)) ||
        getEditParticipantLabel(item?.name || "");

      return {
        title: String(item?.name || `Round ${index + 1}`),
        slotLabel: `Slot ${index + 1}`,
        durationMin: Number(item?.durationMin || 0),
        startTime: String(item?.startTime || "--"),
        endTime: String(item?.endTime || "--"),
        timeLabel: `${String(item?.startTime || "--")} - ${String(item?.endTime || "--")}`,
        meetingDate: String(item?.meetingDate || ""),
        roleLabel,
        roleKey: getAssignmentRoleKey(item?.name || "", roleLabel),
        task: String(item?.task || ""),
        script: String(item?.script || ""),
        notes: buildAssignmentNotes(item, roleLabel),
      };
    });

    console.log("ASSIGNMENT REAL CARDS >>>", JSON.stringify(cards, null, 2));
    sendAssignmentCards(assignmentId, cards as any);
    setAssignmentCardsSentTick(Date.now());

    Alert.alert(
      "Sent",
      `${cards.length} assignment card${cards.length === 1 ? "" : "s"} sent to assignment room.`
    );
  }

  function getFlowZone(name: string) {
    const safe = String(name || "").toLowerCase();

    if (
      safe.includes("opening prayer") ||
      safe.includes("mc opening") ||
      safe.includes("opening")
    ) {
      return "opening";
    }

    if (
      safe.includes("closing prayer") ||
      safe.includes("closing offering") ||
      safe.includes("final announcements") ||
      safe.includes("mc closing") ||
      safe.includes("closing")
    ) {
      return "closing";
    }

    return "middle";
  }

  function getFlowZoneTitle(zone: "opening" | "middle" | "closing") {
    if (zone === "opening") return "OPENING";
    if (zone === "closing") return "CLOSING";
    return "MIDDLE";
  }

  function getFlowZoneSubtitle(zone: "opening" | "middle" | "closing") {
    if (zone === "opening") return "Kickoff / warm-up";
    if (zone === "closing") return "Wrap-up / final moments";
    return "Main flow";
  }

  function getFlowZoneTone(zone: "opening" | "middle" | "closing") {
    if (zone === "opening") {
      return {
        border: "rgba(52,211,153,0.28)",
        bg: "rgba(52,211,153,0.08)",
        text: EMERALD,
      };
    }

    if (zone === "closing") {
      return {
        border: "rgba(217,179,95,0.28)",
        bg: "rgba(217,179,95,0.08)",
        text: GOLD,
      };
    }

    return {
      border: "rgba(56,189,248,0.24)",
      bg: "rgba(56,189,248,0.08)",
      text: CYAN,
    };
  }

  function groupByFlowZone(list: any[]) {
    const grouped = {
      opening: [] as any[],
      middle: [] as any[],
      closing: [] as any[],
    };

    list.forEach((item) => {
      const zone = getFlowZone(item.name) as "opening" | "middle" | "closing";
      grouped[zone].push(item);
    });

    return [
      {
        key: "opening",
        title: getFlowZoneTitle("opening"),
        subtitle: getFlowZoneSubtitle("opening"),
        items: grouped.opening,
      },
      {
        key: "middle",
        title: getFlowZoneTitle("middle"),
        subtitle: getFlowZoneSubtitle("middle"),
        items: grouped.middle,
      },
      {
        key: "closing",
        title: getFlowZoneTitle("closing"),
        subtitle: getFlowZoneSubtitle("closing"),
        items: grouped.closing,
      },
    ].filter((section) => section.items.length > 0);
  }

  function handleEditCard(item: any) {
    const roleValue = cleanRole(item.role || "", item.durationMin || 0);
    setEditingItem(item);
    setEditName(item.name || "");
    setEditRole(roleValue);
    setEditParticipants(parseParticipants(roleValue));
    setEditDuration(String(item.durationMin || ""));
    setEditTask(item.task || "");
  }

  function handleSaveEdit() {
    if (!editingItem) return;

    const nextDuration = Math.max(1, Number(editDuration || 1));
    const nextRole = editParticipants.length ? joinParticipants(editParticipants) : editRole;

    const nextItems = items.map((item: any) => {
      if (item.id !== editingItem.id) return item;

      return {
        ...item,
        role: nextRole,
        durationMin: nextDuration,
        isDurationLocked: true,
      };
    });

    const rebuilt = rebuildScheduleTimeline(nextItems, runtime.liveStartsAt, runtime.scheduleSlots);

    saveChurchProjectMcSchedule(assignmentId, {
      items: rebuilt,
    });

    setEditRole(nextRole);
    setEditParticipants([]);
    setEditingItem(null);
    forceRefresh((x) => x + 1);
  }

  function handleDeleteRound() {
    if (!editingItem) return;

    Alert.alert(
      "Delete round",
      "Unataka kufuta round hii?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const idx = items.findIndex((row) => row.id === editingItem.id);
            if (idx >= 0) {
              items.splice(idx, 1);
            }
            setEditParticipants([]);
            setEditingItem(null);
            setEditParticipants([]);
            forceRefresh((x) => x + 1);
          },
        },
      ]
    );
  }

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [s.iconBtn, pressed ? s.pressed : null]}
        >
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={s.topText}>
          <Text style={s.topTitle} numberOfLines={1}>
            MC Schedule
          </Text>
          <Text style={s.topSub} numberOfLines={1}>
            {assignmentTitle}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={groupedPrograms.length ? [0] : undefined}
      >

                {programTabs.length ? (
          <View
            style={[
              s.programPanel,
              s.programPanelStickyShadow,
              {
                borderColor: selectedProgramTone.softBorder,
                backgroundColor: BG,
              },
            ]}
          >
            <Text style={s.programPanelLabel}>PROGRAM LINE LIST</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.programTabsRow}
            >
              {programTabs.map((group) => {
                const active = selectedProgram?.key === group.key;
                const groupTone = getProgramTone(group.title);

                return (
                  <Pressable
                    key={group.key}
                    onPress={() => setSelectedProgramKey(group.key)}
                    style={({ pressed }) => [
                      s.programTab,
                      active
                        ? [
                            s.programTabActive,
                            {
                              borderColor: groupTone.softBorder,
                              backgroundColor: groupTone.softBg,
                            },
                          ]
                        : null,
                      pressed ? s.pressed : null,
                    ]}
                  >
                    <Text
                      style={[
                        s.programTabText,
                        active ? [s.programTabTextActive, { color: groupTone.text }] : null,
                      ]}
                    >
                      {group.title}
                    </Text>
                    <View
                      style={[
                        s.programCountPill,
                        active
                          ? [s.programCountPillActive, { backgroundColor: groupTone.softBg }]
                          : null,
                      ]}
                    >
                      <Text
                        style={[
                          s.programCountText,
                          active ? [s.programCountTextActive, { color: groupTone.text }] : null,
                        ]}
                      >
                        {group.rows.length}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {(selectedProgram?.key === "all"
          ? groupedVisibleSections
          : [{ key: "single", title: "", subtitle: "", items: visibleItems }]
        ).map((section) => {
          const zoneTone =
            section.key === "single"
              ? null
              : getFlowZoneTone(section.key as "opening" | "middle" | "closing");

          return (
            <View key={section.key} style={section.key === "single" ? null : s.flowSectionWrap}>
              {section.key !== "single" ? (
                <View style={s.flowSectionBlock}>
                  <View
                    style={[
                      s.flowSectionHeader,
                      {
                        borderColor: zoneTone?.border,
                        backgroundColor: zoneTone?.bg,
                      },
                    ]}
                  >
                    <View style={s.flowSectionHeaderTop}>
                      <Text style={[s.flowSectionTitle, { color: zoneTone?.text }]}>
                        {section.title}
                      </Text>

                      <View
                        style={[
                          s.flowSectionCountPill,
                          {
                            borderColor: zoneTone?.border,
                            backgroundColor: zoneTone?.bg,
                          },
                        ]}
                      >
                        <Text style={[s.flowSectionCountText, { color: zoneTone?.text }]}>
                          {section.items.length} {section.items.length === 1 ? "ITEM" : "ITEMS"}
                        </Text>
                      </View>
                    </View>

                    <Text style={s.flowSectionSubtitle}>
                      {section.subtitle}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={s.flowSectionList}>
                {section.items.map((item) => {
                  const roleText = cleanRole(item.role, item.durationMin);
                  const originalIndex = items.findIndex((row) => row.id === item.id) + 1;
                  const tone = getProgramTone(item.name);
                  const isAllView = selectedProgram?.key === "all";
                  const flowBadge = getFlowBadge(item.name);
                  const flowBadgeTone = getFlowBadgeTone(item.name);

                  const isFirstInSection = section.items[0]?.id === item.id;
                  const isLastInSection = section.items[section.items.length - 1]?.id === item.id;

                  return (
                    <View key={item.id} style={s.timelineRow}>
                      <View style={s.timelineCol}>
                        {!isFirstInSection ? (
                          <View
                            style={[
                              s.timelineRailTop,
                              isAllView && flowBadgeTone
                                ? { backgroundColor: flowBadgeTone.border }
                                : null,
                            ]}
                          />
                        ) : (
                          <View style={s.timelineRailSpacer} />
                        )}

                        <View
                          style={[
                            s.timelineNode,
                            {
                              backgroundColor: tone.softBg,
                              borderColor: tone.softBorder,
                            },
                          ]}
                        >
                          <Text style={[s.indexPillText, { color: tone.text }]}>
                            {originalIndex}
                          </Text>
                        </View>

                        {!isLastInSection ? (
                          <View
                            style={[
                              s.timelineRailBottom,
                              isAllView && flowBadgeTone
                                ? { backgroundColor: flowBadgeTone.border }
                                : null,
                            ]}
                          />
                        ) : (
                          <View style={s.timelineRailSpacer} />
                        )}
                      </View>

                      <View
                        style={[
                          s.card,
                          s.timelineCard,
                          s.simpleScheduleCard,
                          isAllView && flowBadgeTone
                            ? {
                                borderColor: flowBadgeTone.cardBorder,
                                backgroundColor: flowBadgeTone.cardBg,
                              }
                            : null,
                        ]}
                      >
                        <View style={s.simpleScheduleCardRow}>
                          <View style={s.simpleScheduleCardLeft}>
                            <Text style={s.simpleScheduleCardTitle} numberOfLines={1}>
                              {item.name}
                            </Text>

                            <View
                              style={[
                                s.simpleScheduleDurationPill,
                                {
                                  borderColor: tone.softBorder,
                                  backgroundColor: tone.softBg,
                                },
                              ]}
                            >
                              <Text style={[s.simpleScheduleDurationText, { color: tone.text }]}>
                                {item.durationMin}m
                              </Text>
                            </View>
                          </View>

                          <Pressable
                            onPress={() => handleEditCard(item)}
                            style={({ pressed }) => [
                              s.editBtn,
                              s.simpleScheduleEditBtn,
                              {
                                backgroundColor: tone.editBg,
                                borderColor: tone.editBorder,
                              },
                              pressed ? s.pressed : null,
                            ]}
                          >
                            <Ionicons name="pencil-outline" size={14} color={tone.text} />
                            
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        

        <View style={s.assignmentSendCard}>
          <View style={s.assignmentSendTop}>
            <View style={s.assignmentSendBadge}>
              <Ionicons name="layers-outline" size={14} color={GOLD} />
              <Text style={s.assignmentSendLabel}>ASSIGNMENT ROOM</Text>
            </View>
          </View>

          <Text style={s.assignmentSendTitle}>
            {assignmentCardsAlreadySent
              ? "Rounds already sent"
              : "Send rounds to assignment room"}
          </Text>

          <Text style={s.assignmentSendSub}>
            Push clean claimable cards for members to pick roles fast.
          </Text>

          <Pressable
            disabled={assignmentCardsAlreadySent || !items.length}
            onPress={handleSendToAssignmentRoom}
            style={({ pressed }) => [
              s.assignmentSendBtn,
              assignmentCardsAlreadySent || !items.length ? s.assignmentSendBtnDisabled : null,
              pressed ? s.pressed : null,
            ]}
          >
            <View style={s.assignmentSendBtnIconWrap}>
              <Ionicons
                name={assignmentCardsAlreadySent ? "checkmark-circle" : "paper-plane-outline"}
                size={18}
                color={assignmentCardsAlreadySent || !items.length ? "rgba(255,255,255,0.72)" : GOLD}
              />
            </View>
            <Text
              style={[
                s.assignmentSendBtnText,
                assignmentCardsAlreadySent || !items.length ? s.assignmentSendBtnTextDisabled : null,
              ]}
            >
              {assignmentCardsAlreadySent ? "Already sent to room" : "Send to Assignment Room"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    
      
      <Modal
        visible={!!editingItem}
        transparent
        animationType="fade"
        onRequestClose={() => {
          Keyboard.dismiss();
          setEditingItem(null);
        }}
      >
        <KeyboardAvoidingView
          style={s.modalWrap}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={s.modalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={s.modalCard}>
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                    contentContainerStyle={s.modalCardContent}
                  >
                    <Text style={s.modalTitle}>Edit Round</Text>
                    <Text style={s.modalSub}>Hapa unabadilisha vitu vidogo tu.</Text>

                    <View style={s.readonlyBox}>
                      <Text style={s.readonlyLabel}>PROGRAM</Text>
                      <Text style={s.readonlyValue}>{editName}</Text>
                    </View>

                    <View style={s.readonlyBox}>
                      <Text style={s.readonlyLabel}>TASK</Text>
                      <Text style={s.readonlyValue}>{editTask}</Text>
                    </View>

                    <View style={s.readonlyBox}>
                      <Text style={s.readonlyLabel}>CURRENT TIME</Text>
                      <Text style={s.readonlyValue}>
                        {editingItem?.startTime || "--"} - {editingItem?.endTime || "--"}
                      </Text>
                    </View>

                    <Text style={s.modalFieldLabel}>Participants / people</Text>

                    <View style={s.optionGroup}>
                      <Text style={s.optionGroupLabel}>Choose inside this group</Text>
                      <View style={s.optionChipsWrap}>
                        {participantOptions.map((option: string) => {
                          const active = editParticipants.includes(option);
                          return (
                            <Pressable
                              key={option}
                              onPress={() => toggleParticipantOption(option)}
                              style={({ pressed }) => [
                                s.optionChip,
                                active ? s.optionChipActive : null,
                                pressed ? s.pressed : null,
                              ]}
                            >
                              <Text
                                style={[
                                  s.optionChipText,
                                  active ? s.optionChipTextActive : null,
                                ]}
                              >
                                {option}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <TextInput
                      value={editParticipants.length ? joinParticipants(editParticipants) : editRole}
                      onChangeText={(value) => {
                        setEditRole(value);
                        setEditParticipants(parseParticipants(value));
                      }}
                      style={s.input}
                      placeholder="Chagua wengi au andika majina"
                      placeholderTextColor="#888"
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={Keyboard.dismiss}
                    />

                    <Text style={s.modalFieldLabel}>Minutes</Text>
                    <TextInput
                      value={editDuration}
                      onChangeText={setEditDuration}
                      style={s.input}
                      keyboardType="numeric"
                      placeholder="10"
                      placeholderTextColor="#888"
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={Keyboard.dismiss}
                    />

                    <Text style={s.modalHint}>
                      Program na task havi-editwi hapa. Unaweza kuchagua participants wengi wa kundi hili, kubadili minutes, au kufuta round.
                    </Text>

                    <View style={s.modalActions}>
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          setEditParticipants([]);
                          setEditingItem(null);
                          setEditParticipants([]);
                        }}
                        style={({ pressed }) => [s.modalGhostBtn, pressed ? s.pressed : null]}
                      >
                        <Text style={s.modalGhostText}>Cancel</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          if (typeof handleDeleteRound === "function") {
                            handleDeleteRound();
                          } else if (editingItem) {
                            const idx = items.findIndex((x: any) => x.id === editingItem.id);
                            if (idx >= 0) items.splice(idx, 1);
                            setEditingItem(null);
                            forceRefresh((x) => x + 1);
                          }
                        }}
                        style={({ pressed }) => [s.modalDeleteBtn, pressed ? s.pressed : null]}
                      >
                        <Ionicons name="trash-outline" size={16} color="#F87171" />
                        <Text style={s.modalDeleteText}>Delete</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          handleSaveEdit();
                        }}
                        style={({ pressed }) => [s.modalSaveBtn, pressed ? s.pressed : null]}
                      >
                        <Ionicons name="checkmark" size={18} color={BG} />
                        <Text style={s.modalSaveText}>Save</Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({

  simpleScheduleCard: {
    minHeight: 112,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  simpleScheduleCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  simpleScheduleCardLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  simpleScheduleCardTitle: {
    flex: 1,
    minWidth: 0,
    color: TEXT,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  simpleScheduleDurationPill: {
    width: 64,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    flexShrink: 0,
  },
  simpleScheduleDurationText: {
    fontSize: 11,
    fontWeight: "900",
  },
  simpleScheduleEditBtn: {
    width: 36,
    height: 30,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  assignmentSendCard: {
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.022)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.12)",
    borderRadius: 24,
    padding: 12,
    gap: 0,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  assignmentSendTop: {
    display: "none",
  },
  assignmentSendBadge: {
    display: "none",
  },
  assignmentSendLabel: {
    display: "none",
  },
  assignmentSendTitle: {
    display: "none",
  },
  assignmentSendSub: {
    display: "none",
  },
  assignmentSendBtn: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: "rgba(217,179,95,0.11)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  assignmentSendBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.12)",
    opacity: 0.72,
  },
  assignmentSendBtnIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  assignmentSendBtnText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  assignmentSendBtnTextDisabled: {
    color: "rgba(255,255,255,0.72)",
  },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    padding: 20,
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
  },

  modalCard: {
    backgroundColor: BG,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },

  modalCardContent: {
    gap: 10,
  },

  modalTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
  },

  readonlyBox: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
    marginTop: 2,
  },

  readonlyLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 10,
  },

  readonlyValue: {
    color: TEXT,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "900",
  },

  modalSub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 2,
  },

  readonlyCard: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  fieldLabel: {
    color: SOFT,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 2,
  },

  modalFieldLabel: {
    color: SOFT,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 8,
  },

  optionGroup: {
    marginTop: 2,
    marginBottom: 12,
  },

  optionGroupLabel: {
    color: SOFTER,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
  },

  optionChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  optionChipActive: {
    borderColor: "rgba(52,211,153,0.30)",
    backgroundColor: "rgba(52,211,153,0.14)",
  },

  optionChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },

  optionChipTextActive: {
    color: EMERALD,
  },

  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: TEXT,
    fontSize: 15,
    fontWeight: "700",
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  inputMultiline: {
    minHeight: 92,
    textAlignVertical: "top",
  },

  editHelp: {
    color: SOFTER,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },

  modalActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 6,
  },

  modalGhostBtn: {
    minWidth: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  modalGhostText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },

  modalDeleteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "rgba(248,113,113,0.08)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.20)",
  },

  modalDeleteText: {
    color: "#F87171",
    fontSize: 14,
    fontWeight: "800",
  },

  modalSaveBtn: {
    minWidth: 112,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: EMERALD,
  },

  modalSaveText: {
    color: BG,
    fontSize: 14,
    fontWeight: "900",
  },

  modalHint: {
    color: SOFTER,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 4,
    marginBottom: 4,
  },

  screen: {
    flex: 1,
    backgroundColor: BG,
  },

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

  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },

  topText: {
    flex: 1,
    minWidth: 0,
  },

  topTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "800",
  },

  topSub: {
    color: SOFT,
    fontSize: 12,
    marginTop: 2,
  },

  content: {
    padding: 12,
    paddingBottom: 40,
    gap: 16,
  },

  programPanel: {
    zIndex: 10,
    backgroundColor: "rgba(11,15,23,0.96)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  programPanelStickyShadow: {
    borderBottomWidth: 0,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
    marginBottom: 18,
  },

  programPanelLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
    marginBottom: 12,
  },

  programTabsRow: {
    gap: 10,
    paddingRight: 10,
    paddingVertical: 2,
  },

  programTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  programTabActive: {
    borderColor: "rgba(52,211,153,0.35)",
    backgroundColor: "rgba(52,211,153,0.12)",
  },

  programTabText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },

  programTabTextActive: {
    color: EMERALD,
  },

  programCountPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    backgroundColor: "rgba(255,255,255,0.07)",
  },

  programCountPillActive: {
    backgroundColor: "rgba(52,211,153,0.16)",
  },

  programCountText: {
    color: SOFT,
    fontSize: 12,
    fontWeight: "900",
  },

  programCountTextActive: {
    color: EMERALD,
  },

  flowBadgePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.10)",
  },

  flowBadgeText: {
    color: TEXT,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  flowSectionWrap: {
    gap: 18,
    marginTop: 4,
  },

  flowSectionBlock: {
    marginTop: 2,
    marginBottom: 2,
  },

  flowSectionHeader: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 12,
  },

  flowSectionHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  flowSectionTitle: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },

  flowSectionSubtitle: {
    color: SOFT,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },

  flowSectionCountPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },

  flowSectionCountText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },

  flowSectionList: {
    gap: 18,
  },

  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },

  timelineCol: {
    width: 56,
    alignItems: "center",
  },

  timelineRailTop: {
    width: 2,
    flex: 1,
    minHeight: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
  },

  timelineRailBottom: {
    width: 2,
    flex: 1,
    minHeight: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
  },

  timelineRailSpacer: {
    width: 2,
    flex: 1,
    minHeight: 14,
    backgroundColor: "transparent",
  },

  timelineNode: {
    width: 54,
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  timelineCard: {
    flex: 1,
    minHeight: 0,
  },

  programListCard: {
    marginTop: 14,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.028)",
  },

  programListHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },

  programListTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
    flex: 1,
  },

  programListMeta: {
    color: SOFT,
    fontSize: 12,
    fontWeight: "800",
  },

  programLineList: {
    gap: 10,
  },

  programLineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },

  programLineSlot: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.25)",
  },

  programLineSlotText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },

  programLineBody: {
    flex: 1,
    minWidth: 0,
  },

  programLineTime: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },

  programLineSub: {
    color: SOFT,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },

  hero: {
    borderRadius: 28,
    padding: 18,
    paddingTop: 22,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 16,
  },

  heroKicker: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    flexShrink: 1,
  },

  heroSlotsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  heroSlotsPillText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
  },

  heroTitle: {
    color: TEXT,
    fontSize: 26,
    lineHeight: 42,
    fontWeight: "900",
    paddingTop: 4,
    flexShrink: 1,
  },

  heroSub: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 16,
  },

  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 28,
    padding: 18,
  },

  headRow: {
    gap: 14,
    marginBottom: 2,
  },

  leftHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },

  indexPill: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },

  indexPillText: {
    color: GOLD,
    fontSize: 18,
    fontWeight: "900",
  },

  titleWrap: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },

  cardTitle: {
    color: TEXT,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },

  cardSub: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },

  timePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(52,211,153,0.11)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.25)",
  },

  timePillText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },

  cardActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  editBtn: {
    width: 36,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  editBtnText: {
    display: "none",
  },

  sectionCard: {
    marginTop: 14,
    borderRadius: 20,
    padding: 15,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.055)",
  },

  label: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },

  value: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "800",
  },

  chatBox: {
    marginTop: 14,
    borderRadius: 22,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },

  chatLabel: {
    color: EMERALD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
  },

  chatList: {
    gap: 12,
  },

  chatRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },

  chatBullet: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 8,
    backgroundColor: EMERALD,
  },

  chatText: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    lineHeight: 24,
  },

  statusCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: "rgba(52,211,153,0.08)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.18)",
  },

  statusLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },

  statusTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 8,
  },

  statusSub: {
    color: SOFTER,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
});
