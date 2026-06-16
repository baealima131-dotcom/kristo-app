import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getChurchProjectElectionState,
  subscribeChurchProjectElection,
} from "@/src/store/churchProjectElectionStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const SOFT = "rgba(255,255,255,0.68)";
const SOFTER = "rgba(255,255,255,0.52)";
const BLUE = "#6EA8FF";

export default function ElectionCandidatesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    assignmentId?: string;
    title?: string;
    subtitle?: string;
  }>();

  const assignmentId = String(params.assignmentId || "");
  const assignmentTitle = String(params.title || "Assignment Room");
  const assignmentSubtitle = String(params.subtitle || "Candidates");
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChurchProjectElection(() => {
      forceRefresh((x) => x + 1);
    });
    return unsubscribe;
  }, []);

  const electionState = getChurchProjectElectionState(assignmentId);

  const ranked = useMemo(
    () => [...electionState.candidates].sort((a, b) => b.votes - a.votes),
    [electionState.candidates]
  );

  const finalists = ranked.slice(0, 3);
  const others = Math.max(0, ranked.length - finalists.length);

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
          <Text style={s.topTitle} numberOfLines={1}>Candidates</Text>
          <Text style={s.topSub} numberOfLines={1}>{assignmentTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.card}>
          <Text style={s.cardLabel}>CANDIDATE WINDOW</Text>
          <Text style={s.cardTitle}>{assignmentTitle}</Text>
          <Text style={s.cardSub}>
            Hapa MC anaona wagombea wote walioingia kwenye uchaguzi ndani ya muda uliowekwa.
          </Text>
        </View>

        <View style={s.summaryGrid}>
          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>TOTAL</Text>
            <Text style={s.summaryValue}>{ranked.length}</Text>
            <Text style={s.summarySub}>Wagombea wote</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>TOP 3</Text>
            <Text style={s.summaryValue}>{finalists.length}</Text>
            <Text style={s.summarySub}>Watakaobaki mwisho</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>OTHERS</Text>
            <Text style={s.summaryValue}>{others}</Text>
            <Text style={s.summarySub}>Wanatabaki nje ya final 3</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>VOTE TYPE</Text>
            <Text style={s.summaryValue} numberOfLines={1}>
              {electionState.voteType === "mc"
                ? "MC vote"
                : electionState.voteType === "branch_leader"
                  ? "Branch leadership"
                  : electionState.voteType === "department"
                    ? "Department"
                    : "Internal"}
            </Text>
            <Text style={s.summarySub}>{electionState.durationDays} days window</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>RANKED LIST</Text>

          {ranked.map((candidate, index) => (
            <View key={candidate.id} style={s.personRow}>
              <View style={s.personAvatar}>
                <Text style={s.personAvatarText}>
                  {candidate.name.trim().charAt(0).toUpperCase()}
                </Text>
              </View>

              <View style={s.personMain}>
                <Text style={s.personName} numberOfLines={1}>{candidate.name}</Text>
                <Text style={s.personSub} numberOfLines={1}>
                  #{index + 1} • {candidate.role} • {candidate.branch}
                </Text>
              </View>

              <View style={s.personVotesPill}>
                <Text style={s.personVotesText}>{candidate.votes} votes</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={s.note}>
          <Text style={s.noteTitle}>Next real step</Text>
          <Text style={s.noteText}>
            Hapa sasa inasoma wagombea kutoka shared election store ya create-election flow.
          </Text>
        </View>
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
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  topText: { flex: 1, minWidth: 0 },
  topTitle: { color: TEXT, fontSize: 17, fontWeight: "800" },
  topSub: { color: SOFT, fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 22,
    padding: 16,
  },
  cardLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cardTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 10,
  },
  cardSub: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryCard: {
    width: "48%",
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
  },
  summaryLabel: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 8,
  },
  summarySub: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 12,
  },
  personAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    marginRight: 12,
  },
  personAvatarText: {
    color: GOLD,
    fontSize: 17,
    fontWeight: "800",
  },
  personMain: {
    flex: 1,
    minWidth: 0,
  },
  personName: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },
  personSub: {
    color: SOFTER,
    fontSize: 12,
    marginTop: 4,
  },
  personVotesPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.18)",
    backgroundColor: "rgba(110,168,255,0.08)",
  },
  personVotesText: {
    color: BLUE,
    fontSize: 12,
    fontWeight: "700",
  },
  note: {
    backgroundColor: "rgba(110,168,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(110,168,255,0.18)",
    borderRadius: 22,
    padding: 16,
  },
  noteTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },
  noteText: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
});
