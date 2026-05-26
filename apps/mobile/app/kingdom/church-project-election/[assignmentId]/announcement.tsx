import React, { useMemo, useState } from "react";
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
const EMERALD = "#34D399";
const PURPLE = "#B784FF";

type Candidate = {
  id: string;
  name: string;
  role: string;
  branch: string;
  votes: number;
};

type AnnouncementStage =
  | "early_out"
  | "top_three_ready"
  | "third_live"
  | "second_live"
  | "winner_live"
  | "completed";

const MOCK_CANDIDATES: Candidate[] = [
  { id: "c1", name: "Alicia Grant", role: "Admin", branch: "Dallas", votes: 13 },
  { id: "c2", name: "Joel Martin", role: "Pastor", branch: "Dallas", votes: 11 },
  { id: "c3", name: "Naomi Reed", role: "Admin", branch: "Dallas", votes: 8 },
  { id: "c4", name: "Michael Reed", role: "Member", branch: "Dallas", votes: 6 },
  { id: "c5", name: "Rachel Moore", role: "Admin", branch: "Dallas", votes: 5 },
];

function stageTitle(stage: AnnouncementStage) {
  if (stage === "early_out") return "Early-out order";
  if (stage === "top_three_ready") return "Top 3 ready";
  if (stage === "third_live") return "Third place live";
  if (stage === "second_live") return "Second place live";
  if (stage === "winner_live") return "Winner live";
  return "Announcement completed";
}

export default function ElectionAnnouncementScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    assignmentId?: string;
    title?: string;
    subtitle?: string;
  }>();

  const assignmentId = String(params.assignmentId || "");
  const assignmentTitle = String(params.title || "Assignment Room");
  const assignmentSubtitle = String(params.subtitle || "Announcement");

  const [stage, setStage] = useState<AnnouncementStage>("early_out");

  const ranked = useMemo(
    () => [...MOCK_CANDIDATES].sort((a, b) => b.votes - a.votes),
    []
  );

  const finalists = ranked.slice(0, 3);
  const earlyOut = ranked.slice(3);

  const third = finalists[2];
  const second = finalists[1];
  const winner = finalists[0];

  function goNextStage() {
    setStage((prev) => {
      if (prev === "early_out") return "top_three_ready";
      if (prev === "top_three_ready") return "third_live";
      if (prev === "third_live") return "second_live";
      if (prev === "second_live") return "winner_live";
      if (prev === "winner_live") return "completed";
      return "completed";
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
          <Text style={s.topTitle} numberOfLines={1}>Announcement</Text>
          <Text style={s.topSub} numberOfLines={1}>{assignmentTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.heroTopRow}>
            <View style={s.heroIcon}>
              <Ionicons name="megaphone-outline" size={22} color={GOLD} />
            </View>

            <View style={s.heroPill}>
              <Text style={s.heroPillText}>{stageTitle(stage)}</Text>
            </View>
          </View>

          <Text style={s.heroKicker}>ANNOUNCEMENT CONTROL</Text>
          <Text style={s.heroTitle}>{assignmentTitle}</Text>
          <Text style={s.heroSub}>
            Hapa ndipo MC na timu ya live wanaweka order ya kutangaza waliotoka mapema, kubaki na top 3, na kufungua mshindi wa mwisho kwa nguvu.
          </Text>

          <View style={s.heroInfoRow}>
            <View style={s.infoChip}>
              <Text style={s.infoChipText}>{assignmentId || "assignment"}</Text>
            </View>
            <View style={s.infoChip}>
              <Text style={s.infoChipText}>{assignmentSubtitle}</Text>
            </View>
          </View>
        </View>

        <View style={s.summaryGrid}>
          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>EARLY OUT</Text>
            <Text style={s.summaryValue}>{earlyOut.length}</Text>
            <Text style={s.summarySub}>Watatajwa kwanza</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>FINAL 3</Text>
            <Text style={s.summaryValue}>{finalists.length}</Text>
            <Text style={s.summarySub}>Kwa live reveal</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>MODE</Text>
            <Text style={s.summaryValue}>
              {stage === "completed" ? "DONE" : "LIVE"}
            </Text>
            <Text style={s.summarySub}>Announcement state</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>NEXT</Text>
            <Text style={s.summaryValue}>{stageTitle(stage)}</Text>
            <Text style={s.summarySub}>Hatua ya sasa</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>ANNOUNCEMENT FLOW</Text>
          <Text style={s.cardTitle}>{stageTitle(stage)}</Text>
          <Text style={s.cardSub}>
            Flow ya siku ya matokeo inaanza na waliotoka mapema, kisha top 3, nafasi ya 3, nafasi ya 2, na mwisho mshindi mkuu.
          </Text>

          <View style={s.flowStack}>
            {[
              "Early-out names",
              "Top 3 locked",
              "Third place",
              "Second place",
              "Winner reveal",
            ].map((item, index) => (
              <View key={item} style={s.flowRow}>
                <View
                  style={[
                    s.flowDot,
                    index <=
                    (stage === "early_out"
                      ? 0
                      : stage === "top_three_ready"
                        ? 1
                        : stage === "third_live"
                          ? 2
                          : stage === "second_live"
                            ? 3
                            : 4)
                      ? s.flowDotOn
                      : s.flowDotOff,
                  ]}
                />
                <Text style={s.flowText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>EARLY ANNOUNCEMENT ORDER</Text>
          <Text style={s.cardSub}>
            Hawa wanatajwa kwanza kabla ya kubaki na top 3.
          </Text>

          {earlyOut.length ? (
            earlyOut.map((candidate, index) => (
              <View key={candidate.id} style={s.rankCard}>
                <Text style={s.rankPlace}>OUT #{index + 1}</Text>
                <Text style={s.rankName}>{candidate.name}</Text>
                <Text style={s.rankSub}>
                  {candidate.role} • {candidate.branch} • {candidate.votes} votes
                </Text>
              </View>
            ))
          ) : (
            <Text style={s.emptyText}>Hakuna early-out list bado.</Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>TOP 3 LIVE REVEAL</Text>
          <Text style={s.cardSub}>
            Hii ndiyo sehemu ya kutangaza nafasi ya 3, ya 2, kisha mshindi.
          </Text>

          <View style={s.finalistsStack}>
            <View style={s.finalistCard}>
              <Text style={s.finalistPlace}>THIRD</Text>
              <Text style={s.finalistName}>{third?.name || "Hidden"}</Text>
              <Text style={s.finalistSub}>{third ? `${third.votes} votes` : "Waiting reveal"}</Text>
            </View>

            <View style={s.finalistCard}>
              <Text style={s.finalistPlace}>SECOND</Text>
              <Text style={s.finalistName}>{second?.name || "Hidden"}</Text>
              <Text style={s.finalistSub}>{second ? `${second.votes} votes` : "Waiting reveal"}</Text>
            </View>

            <View style={[s.finalistCard, s.finalistWinnerCard]}>
              <Text style={s.finalistPlace}>WINNER</Text>
              <Text style={s.finalistName}>{winner?.name || "Hidden"}</Text>
              <Text style={s.finalistSub}>{winner ? `${winner.votes} votes` : "Final reveal"}</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>WINNER CARD</Text>
          <Text style={s.cardTitle}>
            {winner ? `${winner.name}` : "Hidden finalist"}
          </Text>
          <Text style={s.cardSub}>
            {winner
              ? `${winner.role} • ${winner.branch} • ${winner.votes} votes`
              : "Winner atafunguliwa hapa mwisho."}
          </Text>
        </View>

        <View style={s.ctaRow}>
          <Pressable
            onPress={goNextStage}
            style={({ pressed }) => [s.primaryCta, pressed ? s.pressed : null]}
          >
            <Ionicons name="play-forward-outline" size={18} color={GOLD} />
            <Text style={s.primaryCtaText}>Move announcement stage</Text>
          </Pressable>
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

  hero: {
    backgroundColor: "rgba(183,132,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(183,132,255,0.20)",
    borderRadius: 24,
    padding: 18,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  heroPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(183,132,255,0.28)",
    backgroundColor: "rgba(183,132,255,0.12)",
  },
  heroPillText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
  },
  heroKicker: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
  },
  heroSub: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  heroInfoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  infoChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoChipText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
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

  flowStack: {
    marginTop: 12,
    gap: 12,
  },
  flowRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  flowDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 12,
  },
  flowDotOn: {
    backgroundColor: EMERALD,
  },
  flowDotOff: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  flowText: {
    color: TEXT,
    fontSize: 14,
    flex: 1,
  },

  rankCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
    marginTop: 12,
  },
  rankPlace: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  rankName: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 8,
  },
  rankSub: {
    color: SOFT,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 19,
  },

  finalistsStack: {
    gap: 10,
    marginTop: 12,
  },
  finalistCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
  },
  finalistWinnerCard: {
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  finalistPlace: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  finalistName: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 8,
  },
  finalistSub: {
    color: SOFT,
    fontSize: 13,
    marginTop: 6,
  },

  emptyText: {
    color: SOFTER,
    fontSize: 13,
    marginTop: 12,
  },

  ctaRow: {
    gap: 12,
  },
  primaryCta: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.14)",
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryCtaText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },
});
