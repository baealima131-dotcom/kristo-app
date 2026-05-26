import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";

const CHURCH_PROJECT_META = {
  "crown-of-destiny": {
    title: "CROWN OF DESTINY",
    desc: "Mission za maadili ulimwenguni na ushirikiano wa makanisa yote.",
  },
  "agenda": {
    title: "AGENDA",
    desc: "Direction, planning, na alignment ya church projects.",
  },
  "mission": {
    title: "MISSION",
    desc: "Outreach, assignments, na execution ya mission fields.",
  },
  "ethics-council": {
    title: "ETHICS COUNCIL",
    desc: "Mwongozo wa maadili kwa leaders, members, na jamii.",
  },
  "global-prayer": {
    title: "GLOBAL PRAYER",
    desc: "Prayer network ya makanisa kwa dunia nzima.",
  },
  "church-growth": {
    title: "CHURCH GROWTH",
    desc: "Growth systems, discipleship, na expansion.",
  },
  "family-order": {
    title: "FAMILY ORDER",
    desc: "Family restoration, parenting, na nyumba katika order.",
  },
  "youth-fire": {
    title: "YOUTH FIRE",
    desc: "Kuwasha vijana katika purity, purpose, na service.",
  },
} as const;

const CHURCH_PROJECT_BRANCHES = {
  "crown-of-destiny": [
    { id: "moral-reform", title: "Moral Reform", desc: "Campaign ya maadili na tabia njema duniani." },
    { id: "leadership-order", title: "Leadership Order", desc: "Order ya viongozi, uwajibikaji, na mfano bora." },
    { id: "family-restoration", title: "Family Restoration", desc: "Kurejesha msingi wa familia na ndoa." },
    { id: "education-light", title: "Education Light", desc: "Mafundisho ya nuru, uelewa, na wisdom kwa jamii." },
  ],
  "agenda": [
    { id: "strategy-board", title: "Strategy Board", desc: "Main planning na direction ya project." },
    { id: "calendar-flow", title: "Calendar Flow", desc: "Events, timing, na hatua za project." },
    { id: "target-map", title: "Target Map", desc: "Country, church, na audience alignment." },
    { id: "priority-room", title: "Priority Room", desc: "Core priorities na decision flow." },
  ],
  "mission": [
    { id: "field-mission", title: "Field Mission", desc: "Mission coordination kwa maeneo mbalimbali." },
    { id: "church-outreach", title: "Church Outreach", desc: "Outreach ya makanisa na community touch." },
    { id: "follow-up", title: "Follow-up", desc: "Watu wapya, care, na movement ya next step." },
    { id: "reports", title: "Mission Reports", desc: "Reports na updates za mission teams." },
  ],
  "ethics-council": [
    { id: "pastor-guidance", title: "Pastor Guidance", desc: "Mwongozo wa maadili kwa pastors na leaders." },
    { id: "member-discipline", title: "Member Discipline", desc: "Order na accountability kwa members." },
  ],
  "global-prayer": [
    { id: "nations-prayer", title: "Nations Prayer", desc: "Prayer focus kwa mataifa na serikali." },
    { id: "church-covering", title: "Church Covering", desc: "Prayer covering kwa makanisa yote." },
  ],
  "church-growth": [
    { id: "discipleship", title: "Discipleship", desc: "Kukuza waumini kiroho na kimfumo." },
    { id: "membership-growth", title: "Membership Growth", desc: "Growth ya members na retention." },
  ],
  "family-order": [
    { id: "marriage-care", title: "Marriage Care", desc: "Care, healing, na order kwa ndoa." },
    { id: "parenting", title: "Parenting", desc: "Malezi, wisdom, na guidance kwa wazazi." },
  ],
  "youth-fire": [
    { id: "youth-discipleship", title: "Youth Discipleship", desc: "Discipleship na mentorship kwa vijana." },
    { id: "creative-unit", title: "Creative Unit", desc: "Media, design, music, na youth expression." },
  ],
} as const;

export default function ChurchProjectDetailScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const safeProjectId = String(projectId || "crown-of-destiny") as keyof typeof CHURCH_PROJECT_META;
  const meta = CHURCH_PROJECT_META[safeProjectId] ?? CHURCH_PROJECT_META["crown-of-destiny"];
  const branches = CHURCH_PROJECT_BRANCHES[safeProjectId] ?? CHURCH_PROJECT_BRANCHES["crown-of-destiny"];

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>

        <Text style={s.eyebrow}>Project Results</Text>
        <Text style={s.title}>{meta.title}</Text>
        <Text style={s.subtitle}>{meta.desc}</Text>

        <Text style={s.sectionTitle}>Branches</Text>

        <View style={s.list}>
          {branches.map((branch) => (
            <View key={branch.id} style={s.branchCard}>
              <View style={s.branchTopRow}>
                <View style={s.branchIcon}>
                  <Ionicons name="git-branch-outline" size={22} color="#fff" />
                </View>

                <View style={s.branchTextCol}>
                  <Text style={s.branchTitle}>{branch.title}</Text>
                  <Text style={s.branchDesc}>{branch.desc}</Text>
                </View>
              </View>

              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/kingdom/church-project-branch/[branchId]",
                    params: {
                      branchId: branch.id,
                      projectId: safeProjectId,
                    },
                  } as any)
                }
                style={s.enterBtn}
              >
                <Text style={s.enterText}>OPEN</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { padding: 22, paddingTop: 54, paddingBottom: 40 },
  backBtn: {
    width: 58,
    height: 58,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 10,
    color: SOFT,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 14,
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  list: { gap: 14 },
  branchCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 16,
    gap: 16,
  },
  branchTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  branchTextCol: {
    flex: 1,
    minWidth: 0,
  },
  branchIcon: {
    width: 74,
    height: 74,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  branchTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  branchDesc: {
    marginTop: 8,
    color: SOFT,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
  enterBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
  },
  enterText: {
    color: "#F3C86B",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
