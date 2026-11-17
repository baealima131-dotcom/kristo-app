import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { CINZEL_SEMIBOLD_FAMILY } from "@/src/lib/cinzelFont";
import {
  CHURCH_APPLICATION_STATUS_COLORS,
  CHURCH_APPLICATION_STATUS_LABELS,
  fetchMyChurchApplication,
  formatShortDate,
  formatTimeRemaining,
  isDeadlinePassed,
  respondToChurchApplication,
  type ApplicantApplication,
  type ApplicantRequirement,
  type ChurchApplicationStatus,
  type PendingChurchForMember,
} from "@/src/lib/churchApplicationsApi";
import { rememberChurchActivationState } from "@/src/components/church/ChurchActivationGate";

const BG = "#05070D";
const CARD = "rgba(255,255,255,0.045)";
const GOLD = "#D9B35F";
const TITLE_GOLD = "#F4D06F";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.62)";
const BLUE = "#93C5FD";
const GREEN = "#86EFAC";

/** Simple applicant-facing steps; the current status is highlighted. */
const STEPS: { key: ChurchApplicationStatus[]; label: string }[] = [
  { key: ["pending_review", "more_info_needed"], label: "Review" },
  { key: ["conditionally_approved", "requirements_in_progress", "expired"], label: "Requirements" },
  { key: ["ready_for_admin_review"], label: "Final review" },
  { key: ["active"], label: "Active" },
];

function StatusPill({ status }: { status: ChurchApplicationStatus }) {
  const color = CHURCH_APPLICATION_STATUS_COLORS[status] || GOLD;
  return (
    <View style={[s.pill, { borderColor: color, backgroundColor: `${color}22` }]}>
      <View style={[s.pillDot, { backgroundColor: color }]} />
      <Text style={[s.pillText, { color }]}>{CHURCH_APPLICATION_STATUS_LABELS[status]}</Text>
    </View>
  );
}

function Steps({ status }: { status: ChurchApplicationStatus }) {
  if (status === "rejected") return null;
  const current = STEPS.findIndex((step) => step.key.includes(status));
  return (
    <View style={s.steps}>
      {STEPS.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <View key={step.label} style={s.step}>
            <View style={[s.stepDot, done && s.stepDotDone, now && s.stepDotNow]}>
              {done ? <Ionicons name="checkmark" size={12} color="#0B0F17" /> : <Text style={s.stepNum}>{i + 1}</Text>}
            </View>
            <Text style={[s.stepLabel, (done || now) && { color: TEXT }]} numberOfLines={1}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function RequirementRow({ r }: { r: Pick<ApplicantRequirement, "kind" | "title" | "target" | "current" | "deadlineAt" | "completed"> & { description?: string } }) {
  const isMembers = r.kind === "verified_members";
  const current = Math.max(0, Number(r.current || 0));
  const target = Math.max(1, Number(r.target || 1));
  const pct = r.completed ? 1 : Math.min(1, current / target);
  const remaining = formatTimeRemaining(r.deadlineAt);
  const overdue = !r.completed && isDeadlinePassed(r.deadlineAt);
  return (
    <View style={[s.req, r.completed && s.reqDone]}>
      <View style={s.reqTop}>
        <View style={[s.reqIcon, r.completed && { backgroundColor: "rgba(134,239,172,0.16)", borderColor: "rgba(134,239,172,0.5)" }]}>
          <Ionicons
            name={r.completed ? "checkmark" : isMembers ? "people-outline" : "shield-checkmark-outline"}
            size={16}
            color={r.completed ? GREEN : GOLD}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.reqTitle}>{r.title}</Text>
          {r.description ? <Text style={s.reqDesc}>{r.description}</Text> : null}
        </View>
      </View>

      {isMembers ? (
        <>
          <View style={s.progressRow}>
            <Text style={s.progressBig}>
              {current}
              <Text style={s.progressOf}> / {target} verified members</Text>
            </Text>
          </View>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${Math.round(pct * 100)}%` }, r.completed && { backgroundColor: GREEN }]} />
          </View>
        </>
      ) : (
        <Text style={s.manualNote}>{r.completed ? "Confirmed by Kristo App" : "Kristo App will confirm this"}</Text>
      )}

      <View style={s.reqFoot}>
        <Ionicons name="time-outline" size={13} color={overdue ? "#FB7185" : MUTED} />
        <Text style={[s.reqFootText, overdue && { color: "#FB7185" }]}>
          {r.completed ? "Completed" : `${remaining} • due ${formatShortDate(r.deadlineAt)}`}
        </Text>
      </View>
    </View>
  );
}

/** What the Pastor should do now, in plain words. */
function nextSteps(app: ApplicantApplication): string[] {
  const open = app.requirements.filter((r) => !r.completed);
  if (app.status === "pending_review") return ["Kristo App is reviewing your application. You will see the decision here."];
  if (app.status === "more_info_needed") return ["Answer Kristo App's question below and send it."];
  if (app.status === "ready_for_admin_review") return ["All requirements are complete. Kristo App is doing the final review."];
  if (app.status === "expired") return ["A deadline passed. Contact Kristo App Support to ask for more time."];
  if (app.status === "rejected") return ["This application was not approved. You can apply again."];
  if (app.status === "active") return ["Your church is active. Posting and ministries are open."];
  const steps: string[] = [];
  for (const r of open) {
    if (r.kind === "verified_members") {
      const left = Math.max(0, Number(r.target || 0) - Number(r.current || 0));
      steps.push(
        `Invite members with Church ID ${app.churchId} and approve their join requests: ${left} more by ${formatShortDate(r.deadlineAt)}.`
      );
    } else {
      steps.push(`Kristo App will confirm "${r.title}" by ${formatShortDate(r.deadlineAt)}.`);
    }
  }
  steps.push(
    app.activationMode === "auto"
      ? "Your church opens automatically when everything is complete."
      : "When everything is complete, Kristo App does a final review and activates your church."
  );
  return steps;
}

function LockedAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.actionRow} accessibilityRole="button" accessibilityState={{ disabled: true }}>
      <View style={[s.actionIcon, s.actionIconLocked]}>
        <Ionicons name={icon} size={17} color={MUTED} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.actionLabel, { color: MUTED }]}>{label}</Text>
        <Text style={s.actionHint}>Opens when your church is active</Text>
      </View>
      <Ionicons name="lock-closed" size={15} color={MUTED} />
    </Pressable>
  );
}

export default function ChurchApplicationScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [app, setApp] = useState<ApplicantApplication | null>(null);
  const [pendingChurch, setPendingChurch] = useState<PendingChurchForMember | null>(null);
  const [response, setResponse] = useState("");
  const [address, setAddress] = useState("");
  const [sending, setSending] = useState(false);
  const markedSeen = useRef(false);
  const params = useLocalSearchParams<{ focus?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const requirementsY = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollToRequirements = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, requirementsY.current - 12), animated: true });
  }, []);

  const explainLocked = useCallback(
    (what: string) => {
      Alert.alert(
        `${what} is not available yet`,
        "Your church opens for posting and ministries when every requirement is complete and Kristo App activates it.",
        [{ text: "See requirements", onPress: scrollToRequirements }]
      );
    },
    [scrollToRequirements]
  );

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    const res = await fetchMyChurchApplication({ markSeen: !markedSeen.current });
    if (res.ok) {
      markedSeen.current = true;
      setApp(res.data.application);
      setPendingChurch(res.data.pendingChurch);
      const a = res.data.application;
      rememberChurchActivationState({
        locked: (!!a?.churchId && a.status !== "active" && a.status !== "rejected") || !!res.data.pendingChurch,
        churchName: a?.church.name || res.data.pendingChurch?.churchName,
      });
      setError("");
      if (res.data.application) setAddress((prev) => prev || res.data.application?.church.address || "");
    } else {
      setError(res.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (app?.status === "active" && app.churchId) markedSeen.current = true;
  }, [app?.status, app?.churchId]);

  // Opened from a locked feature ("View church requirements"): jump to the requirements.
  useEffect(() => {
    if (loading || params.focus !== "requirements") return;
    const t = setTimeout(scrollToRequirements, 350);
    return () => clearTimeout(t);
  }, [loading, params.focus, scrollToRequirements]);

  const onRespond = async () => {
    if (!app || !response.trim() || sending) return;
    setSending(true);
    const res = await respondToChurchApplication(
      app.id,
      response.trim(),
      address.trim() && address.trim() !== (app.church.address || "") ? { address: address.trim() } : undefined
    );
    setSending(false);
    if (!res.ok) {
      Alert.alert("Could not send", res.message);
      return;
    }
    setApp(res.data);
    setResponse("");
    Alert.alert("Sent", "Your answer was sent. Kristo App will review your application again.");
  };

  const header = (
    <View style={s.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/more" as any))}
        hitSlop={10}
        style={s.headerBtn}
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={TEXT} />
      </Pressable>
      <Text style={s.headerTitle} numberOfLines={1}>
        {app?.churchId && app.status !== "rejected" && app.status !== "active" ? "CHURCH REQUIREMENTS" : "CHURCH APPLICATION"}
      </Text>
      <Pressable onPress={() => void load("refresh")} hitSlop={10} style={s.headerBtn} accessibilityLabel="Refresh">
        <Ionicons name="refresh" size={19} color={GOLD} />
      </Pressable>
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  } else if (error && !app && !pendingChurch) {
    body = (
      <View style={s.center}>
        <Text style={s.muted}>{error}</Text>
        <Pressable onPress={() => void load()} style={s.outlineBtn}>
          <Text style={s.outlineBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (!app && pendingChurch) {
    // A member of a church that is not open yet.
    body = (
      <>
        <View style={s.card}>
          <Text style={s.eyebrow}>YOUR CHURCH</Text>
          <Text style={s.churchName}>{pendingChurch.churchName}</Text>
          <Text style={s.muted}>Church ID {pendingChurch.churchId}</Text>
          {pendingChurch.applicationStatus ? (
            <View style={{ marginTop: 12 }}>
              <StatusPill status={pendingChurch.applicationStatus} />
            </View>
          ) : null}
          <Text style={[s.body, { marginTop: 12 }]}>
            This church is not active on Kristo App yet. It opens when its requirements are complete and Kristo App
            activates it.
          </Text>
        </View>
        {pendingChurch.requirements.length ? <Text style={s.section}>Requirements</Text> : null}
        {pendingChurch.requirements.map((r, i) => (
          <RequirementRow key={`${r.title}-${i}`} r={r as any} />
        ))}
      </>
    );
  } else if (!app) {
    body = (
      <View style={s.card}>
        <MaterialCommunityIcons name="church" size={30} color={GOLD} />
        <Text style={[s.churchName, { marginTop: 10 }]}>No church application</Text>
        <Text style={s.body}>Pastors and church leaders apply for their church. Kristo App reviews every application.</Text>
        <Pressable onPress={() => router.push("/more/church/create" as any)} style={[s.goldBtn, { marginTop: 16 }]}>
          <Text style={s.goldBtnText}>Apply for a church</Text>
        </Pressable>
      </View>
    );
  } else {
    const provisioned = !!app.churchId && app.status !== "rejected";
    body = (
      <>
        <View style={s.card}>
          <View style={s.cardTop}>
            <View style={s.churchIcon}>
              <MaterialCommunityIcons name="church" size={22} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.churchName}>{app.church.name}</Text>
              <Text style={s.muted}>
                {[app.church.city, app.church.country].filter(Boolean).join(", ")}
              </Text>
            </View>
          </View>
          <View style={{ marginTop: 14 }}>
            <StatusPill status={app.status} />
          </View>
          <Steps status={app.status} />
          <View style={s.metaGrid}>
            <Text style={s.metaLabel}>Application</Text>
            <Text style={s.metaValue}>{app.id}</Text>
            <Text style={s.metaLabel}>Submitted</Text>
            <Text style={s.metaValue}>
              {formatShortDate(app.submittedAt)}
              {app.source === "agent" && app.agentName ? ` • by agent ${app.agentName}` : ""}
            </Text>
            {provisioned ? (
              <>
                <Text style={s.metaLabel}>Church ID</Text>
                <Text style={[s.metaValue, { color: TITLE_GOLD }]}>{app.churchId}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={[s.card, s.messageCard]}>
          <View style={s.cardTop}>
            <Ionicons name="clipboard-outline" size={18} color={GOLD} />
            <Text style={s.messageTitle}>Instructions</Text>
          </View>
          {app.adminMessage ? (
            <View style={s.adminMsg}>
              <Text style={s.adminMsgLabel}>From Kristo App{app.adminMessageAt ? ` · ${formatShortDate(app.adminMessageAt)}` : ""}</Text>
              <Text style={s.body}>{app.adminMessage}</Text>
            </View>
          ) : null}
          <Text style={[s.adminMsgLabel, { marginTop: 12 }]}>Next step</Text>
          {nextSteps(app).map((step, i) => (
            <View key={i} style={s.stepRow}>
              <View style={s.stepBullet} />
              <Text style={[s.body, { flex: 1 }]}>{step}</Text>
            </View>
          ))}
        </View>

        {app.status === "more_info_needed" ? (
          <View style={s.card}>
            <Text style={s.eyebrow}>YOUR ANSWER</Text>
            <TextInput
              value={response}
              onChangeText={setResponse}
              placeholder="Answer the admin's question"
              placeholderTextColor="rgba(255,255,255,0.35)"
              multiline
              maxLength={1000}
              style={[s.input, { minHeight: 90 }]}
            />
            <Text style={[s.eyebrow, { marginTop: 12 }]}>CHURCH ADDRESS (OPTIONAL)</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Street, area"
              placeholderTextColor="rgba(255,255,255,0.35)"
              maxLength={200}
              style={s.input}
            />
            <Pressable
              onPress={() => void onRespond()}
              disabled={!response.trim() || sending}
              style={[s.goldBtn, { marginTop: 14 }, (!response.trim() || sending) && { opacity: 0.45 }]}
            >
              {sending ? <ActivityIndicator color="#0B0F17" /> : <Text style={s.goldBtnText}>Send to Kristo App</Text>}
            </Pressable>
          </View>
        ) : null}

        {app.requirements.length ? (
          <View onLayout={(e) => (requirementsY.current = e.nativeEvent.layout.y)}>
            <Text style={s.section}>
              Requirements{" "}
              <Text style={s.sectionCount}>
                {app.requirements.filter((r) => r.completed).length}/{app.requirements.length} done
              </Text>
            </Text>
            {app.requirements.map((r) => (
              <RequirementRow key={r.id} r={r} />
            ))}
          </View>
        ) : null}

        {provisioned && app.status !== "active" ? (
          <View style={s.card}>
            <Text style={s.eyebrow}>CHURCH ACTIONS</Text>
            <Pressable onPress={() => router.push("/church/members" as any)} style={s.actionRow} accessibilityRole="button">
              <View style={s.actionIcon}>
                <Ionicons name="people-outline" size={17} color={GOLD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.actionLabel}>Members & join requests</Text>
                <Text style={s.actionHint}>Approve members who join with your Church ID</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={MUTED} />
            </Pressable>
            <LockedAction icon="create-outline" label="Create church post" onPress={() => explainLocked("Posting")} />
            <LockedAction icon="grid-outline" label="Create ministry" onPress={() => explainLocked("Creating a ministry")} />
          </View>
        ) : null}

        {app.status === "rejected" && !app.churchId ? (
          <Pressable onPress={() => router.push("/more/church/create" as any)} style={[s.outlineBtn, { marginBottom: 14 }]}>
            <Text style={s.outlineBtnText}>Apply again</Text>
          </Pressable>
        ) : null}

        {app.status === "active" ? (
          <Pressable onPress={() => router.replace("/church/overview" as any)} style={[s.goldBtn, { marginBottom: 14 }]}>
            <Text style={s.goldBtnText}>Open Church Overview</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => setHistoryOpen((v) => !v)} style={s.historyToggle} accessibilityRole="button" accessibilityState={{ expanded: historyOpen }}>
          <Text style={s.section}>History</Text>
          <Ionicons name={historyOpen ? "chevron-up" : "chevron-down"} size={17} color={MUTED} />
        </Pressable>
        {historyOpen ? (
        <View style={s.card}>
          {[...app.timeline].reverse().map((e, i, arr) => (
            <View key={`${e.at}-${i}`} style={s.tl}>
              <View style={s.tlRail}>
                <View style={[s.tlDot, i === 0 && { backgroundColor: GOLD }]} />
                {i < arr.length - 1 ? <View style={s.tlLine} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 14 }}>
                <Text style={s.tlTitle}>{e.statusLabel || timelineLabel(e.type)}</Text>
                <Text style={s.muted}>{formatShortDate(e.at)}</Text>
                {e.message ? <Text style={[s.body, { marginTop: 4 }]}>{e.message}</Text> : null}
              </View>
            </View>
          ))}
        </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={[s.safe, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[s.content, { paddingBottom: 120 + insets.bottom }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={GOLD} />}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function timelineLabel(type: string) {
  if (type === "requirements_changed") return "Requirements updated";
  if (type === "deadline_extended") return "Deadline extended";
  if (type === "requirement_met") return "Requirement met";
  if (type === "requirement_confirmed") return "Requirement confirmed";
  return "Update";
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerTitle: { flex: 1, textAlign: "center", color: TITLE_GOLD, fontFamily: CINZEL_SEMIBOLD_FAMILY, fontSize: 18, letterSpacing: 1 },
  content: { paddingHorizontal: 16, paddingTop: 6 },
  center: { paddingTop: 80, alignItems: "center", gap: 14 },
  card: {
    borderRadius: 22,
    borderWidth: 1.4,
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: CARD,
    padding: 16,
    marginBottom: 14,
  },
  messageCard: { borderColor: "rgba(244,208,111,0.6)", backgroundColor: "rgba(244,208,111,0.07)" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  churchIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.1)",
  },
  churchName: { color: TEXT, fontSize: 19, fontWeight: "900" },
  eyebrow: { color: GOLD, fontSize: 11, fontWeight: "900", letterSpacing: 1.1, marginBottom: 6 },
  body: { color: "rgba(255,255,255,0.84)", fontSize: 14, lineHeight: 20, fontWeight: "600" },
  muted: { color: MUTED, fontSize: 12.5, fontWeight: "700" },
  section: { color: TITLE_GOLD, fontSize: 15, fontWeight: "900", marginTop: 6, marginBottom: 8, letterSpacing: 0.4 },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: "900" },
  steps: { flexDirection: "row", marginTop: 16, gap: 6 },
  step: { flex: 1, alignItems: "center", gap: 6 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  stepDotDone: { backgroundColor: GOLD, borderColor: GOLD },
  stepDotNow: { borderColor: GOLD, backgroundColor: "rgba(217,179,95,0.18)" },
  stepNum: { color: MUTED, fontSize: 11, fontWeight: "900" },
  stepLabel: { color: MUTED, fontSize: 11, fontWeight: "800" },
  metaGrid: { marginTop: 16, flexDirection: "row", flexWrap: "wrap", rowGap: 6 },
  metaLabel: { width: "34%", color: MUTED, fontSize: 12.5, fontWeight: "700" },
  metaValue: { width: "66%", color: TEXT, fontSize: 12.5, fontWeight: "800" },
  messageTitle: { color: TITLE_GOLD, fontSize: 15, fontWeight: "900" },
  adminMsg: { marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.05)" },
  adminMsgLabel: { color: GOLD, fontSize: 11.5, fontWeight: "900", letterSpacing: 0.6, marginBottom: 4 },
  stepRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  stepBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD, marginTop: 7 },
  sectionCount: { color: MUTED, fontSize: 13, fontWeight: "800" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.1)",
  },
  actionIconLocked: { borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.04)" },
  actionLabel: { color: TEXT, fontSize: 14.5, fontWeight: "900" },
  actionHint: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 1 },
  historyToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    color: TEXT,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: "top",
  },
  goldBtn: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9C46A",
    borderWidth: 1,
    borderColor: "rgba(255,226,140,0.95)",
  },
  goldBtnText: { color: "#07101A", fontWeight: "900", fontSize: 15 },
  outlineBtn: {
    minHeight: 44,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  outlineBtnText: { color: GOLD, fontWeight: "900", fontSize: 14 },
  req: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.32)",
    backgroundColor: "rgba(147,197,253,0.06)",
    padding: 14,
    marginBottom: 10,
  },
  reqDone: { borderColor: "rgba(134,239,172,0.4)", backgroundColor: "rgba(134,239,172,0.06)" },
  reqTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  reqIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.1)",
  },
  reqTitle: { color: TEXT, fontSize: 15, fontWeight: "900" },
  reqDesc: { color: MUTED, fontSize: 12.5, marginTop: 2, fontWeight: "600" },
  progressRow: { marginTop: 12 },
  progressBig: { color: BLUE, fontSize: 24, fontWeight: "900" },
  progressOf: { color: MUTED, fontSize: 13, fontWeight: "800" },
  bar: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 8, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: BLUE },
  manualNote: { color: MUTED, fontSize: 12.5, marginTop: 10, fontWeight: "700" },
  reqFoot: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  reqFootText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  tl: { flexDirection: "row", gap: 12 },
  tlRail: { alignItems: "center", width: 14 },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.3)", marginTop: 4 },
  tlLine: { flex: 1, width: 2, backgroundColor: "rgba(255,255,255,0.1)", marginTop: 4 },
  tlTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
});
