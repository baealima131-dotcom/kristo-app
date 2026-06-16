import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";

const BRANCH_META = {
  "moral-reform": {
    title: "Moral Reform",
    desc: "Campaign ya maadili na tabia njema duniani.",
  },
  "leadership-order": {
    title: "Leadership Order",
    desc: "Order ya viongozi, uwajibikaji, na mfano bora.",
  },
  "family-restoration": {
    title: "Family Restoration",
    desc: "Kurejesha msingi wa familia na ndoa.",
  },
  "education-light": {
    title: "Education Light",
    desc: "Mafundisho ya nuru, uelewa, na wisdom kwa jamii.",
  },
  "strategy-board": {
    title: "Strategy Board",
    desc: "Main planning na direction ya project.",
  },
  "calendar-flow": {
    title: "Calendar Flow",
    desc: "Events, timing, na hatua za project.",
  },
  "target-map": {
    title: "Target Map",
    desc: "Country, church, na audience alignment.",
  },
  "priority-room": {
    title: "Priority Room",
    desc: "Core priorities na decision flow.",
  },
} as const;

const BRANCH_ASSIGNMENTS: Record<string, Array<{
  id: string;
  title: string;
  country: string;
  church: string;
  people: string;
  leaders: string;
  admin: string;
  status: "LIVE" | "SOON" | "DRAFT";
}>> = {
  "moral-reform": [
    {
      id: "mr-usa-1",
      title: "Moral Reform • Dallas",
      country: "USA",
      church: "TLMC Dallas",
      people: "48 people",
      leaders: "Pastor Daniel, Leader Ruth",
      admin: "Admin James",
      status: "LIVE",
    },
    {
      id: "mr-bi-1",
      title: "Moral Reform • Bujumbura",
      country: "Burundi",
      church: "Bujumbura Church",
      people: "32 people",
      leaders: "Leader Amani, Pastor Eliya",
      admin: "Admin Grace",
      status: "SOON",
    },
    {
      id: "mr-tz-1",
      title: "Moral Reform • Dar",
      country: "Tanzania",
      church: "TLMC Dar",
      people: "65 people",
      leaders: "Pastor Neema, Leader John",
      admin: "Admin Paul",
      status: "DRAFT",
    },
  ],
  "leadership-order": [
    {
      id: "lo-usa-1",
      title: "Leadership Order • Fort Worth",
      country: "USA",
      church: "TLMC Fort Worth",
      people: "16 leaders",
      leaders: "Pastor Mark, Elder Ruth",
      admin: "Admin Kevin",
      status: "LIVE",
    },
    {
      id: "lo-ke-1",
      title: "Leadership Order • Nairobi",
      country: "Kenya",
      church: "Nairobi Church",
      people: "21 leaders",
      leaders: "Pastor Peter, Leader Mercy",
      admin: "Admin Faith",
      status: "SOON",
    },
  ],
  "family-restoration": [
    {
      id: "fr-ug-1",
      title: "Family Restoration • Kampala",
      country: "Uganda",
      church: "Kampala Church",
      people: "27 families",
      leaders: "Pastor Isaac, Mama Grace",
      admin: "Admin Hope",
      status: "SOON",
    },
  ],
  "education-light": [
    {
      id: "el-congo-1",
      title: "Education Light • Goma",
      country: "DR Congo",
      church: "Goma Church",
      people: "54 students",
      leaders: "Leader Moise, Pastor Esther",
      admin: "Admin Olive",
      status: "DRAFT",
    },
  ],
  "strategy-board": [
    {
      id: "sb-usa-1",
      title: "Strategy Board • Fort Worth",
      country: "USA",
      church: "TLMC Fort Worth",
      people: "12 core planners",
      leaders: "Pastor Mark, Leader Ruth",
      admin: "Admin Kevin",
      status: "LIVE",
    },
    {
      id: "sb-ke-1",
      title: "Strategy Board • Nairobi",
      country: "Kenya",
      church: "Nairobi Church",
      people: "9 planners",
      leaders: "Pastor Peter, Leader Mercy",
      admin: "Admin Faith",
      status: "SOON",
    },
  ],
  "calendar-flow": [
    {
      id: "cf-usa-1",
      title: "Calendar Flow • Fort Worth",
      country: "USA",
      church: "TLMC Fort Worth",
      people: "24 attendees",
      leaders: "Pastor Mark, Leader Ruth",
      admin: "Admin Kevin",
      status: "LIVE",
    },
    {
      id: "cf-tz-1",
      title: "Calendar Flow • Dar",
      country: "Tanzania",
      church: "TLMC Dar",
      people: "31 attendees",
      leaders: "Pastor Neema, Leader John",
      admin: "Admin Paul",
      status: "SOON",
    },
    {
      id: "cf-bi-1",
      title: "Calendar Flow • Bujumbura",
      country: "Burundi",
      church: "Bujumbura Church",
      people: "18 attendees",
      leaders: "Leader Amani, Pastor Eliya",
      admin: "Admin Grace",
      status: "DRAFT",
    },
  ],
  "target-map": [
    {
      id: "tm-usa-1",
      title: "Target Map • Dallas",
      country: "USA",
      church: "TLMC Dallas",
      people: "42 members",
      leaders: "Pastor Daniel, Leader Ruth",
      admin: "Admin James",
      status: "LIVE",
    },
    {
      id: "tm-congo-1",
      title: "Target Map • Goma",
      country: "DR Congo",
      church: "Goma Church",
      people: "37 members",
      leaders: "Leader Moise, Pastor Esther",
      admin: "Admin Olive",
      status: "SOON",
    },
  ],
  "priority-room": [
    {
      id: "pr-usa-1",
      title: "Priority Room • Fort Worth",
      country: "USA",
      church: "TLMC Fort Worth",
      people: "7 leaders",
      leaders: "Pastor Mark, Elder Ruth",
      admin: "Admin Kevin",
      status: "LIVE",
    },
    {
      id: "pr-ug-1",
      title: "Priority Room • Kampala",
      country: "Uganda",
      church: "Kampala Church",
      people: "6 leaders",
      leaders: "Pastor Isaac, Mama Grace",
      admin: "Admin Hope",
      status: "SOON",
    },
  ],
};

export default function ChurchProjectBranchScreen() {
  const router = useRouter();
  const { branchId, projectId } = useLocalSearchParams<{
    branchId?: string;
    projectId?: string;
  }>();

  const safeBranchId = String(branchId || "moral-reform");
  const meta = BRANCH_META[safeBranchId as keyof typeof BRANCH_META] ?? {
    title: "Project Branch",
    desc: "Branch detail",
  };

  const assignments = BRANCH_ASSIGNMENTS[safeBranchId] || [];

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>

        <Text style={s.eyebrow}>Branch Results</Text>
        <Text style={s.title}>{meta.title}</Text>
        <Text style={s.subtitle}>{meta.desc}</Text>

        <Text style={s.sectionTitle}>Assignments</Text>

        <View style={s.list}>
          {assignments.map((item) => (
            <Pressable
              key={item.id}
              onPress={() =>
                router.push({
                  pathname: "/kingdom/church-project-assignment/[assignmentId]",
                  params: {
                    assignmentId: item.id,
                    branchId: safeBranchId,
                    projectId: String(projectId || "crown-of-destiny"),
                  },
                } as any)
              }
              style={({ pressed }) => [
                s.card,
                pressed ? { opacity: 0.96, transform: [{ scale: 0.995 }] } : null,
              ]}
            >
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{item.title}</Text>
                  <Text style={s.cardSub}>{item.country} • {item.church}</Text>
                </View>

                <View
                  style={[
                    s.badge,
                    item.status === "LIVE" ? s.badgeLive : null,
                    item.status === "SOON" ? s.badgeSoon : null,
                    item.status === "DRAFT" ? s.badgeDraft : null,
                  ]}
                >
                  <Text style={s.badgeText}>{item.status}</Text>
                </View>
              </View>

              <Text style={s.metaLine}>People: {item.people}</Text>
              <Text style={s.metaLine}>Leaders: {item.leaders}</Text>
              <Text style={s.metaLine}>Admin: {item.admin}</Text>

              <View style={s.btnRow}>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    router.push({
                      pathname: "/kingdom/[id]",
                      params: {
                        id: "churches",
                        openProjectId: String(projectId || "crown-of-destiny"),
                        openBranchId: safeBranchId,
                      },
                    } as any);
                  }}
                  style={s.mainBtn}
                >
                  <Text style={s.mainBtnText}>OPEN BUILDER</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}

          {!assignments.length ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>No assignment cards yet</Text>
              <Text style={s.emptyDesc}>
                Hapa utaweka cards za kazi ya branch hii kwa nchi tofauti, watu tofauti, leaders tofauti, na admins tofauti.
              </Text>
            </View>
          ) : null}
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
    fontSize: 34,
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
  card: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 16,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  cardTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  cardSub: {
    marginTop: 6,
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  metaLine: {
    color: SOFT,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeLive: {
    backgroundColor: "rgba(16,185,129,0.18)",
    borderColor: "rgba(16,185,129,0.40)",
  },
  badgeSoon: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderColor: "rgba(217,179,95,0.40)",
  },
  badgeDraft: {
    backgroundColor: "rgba(148,163,184,0.18)",
    borderColor: "rgba(148,163,184,0.40)",
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  btnRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 10,
  },
  mainBtn: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
  },
  mainBtnText: {
    color: "#F3C86B",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  emptyCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyDesc: {
    marginTop: 8,
    color: SOFT,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
});
