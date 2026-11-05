import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  adminChurchApplicationAction,
  createRequirementTemplate,
  deleteRequirementTemplate,
  fetchAdminChurchApplication,
  fetchRequirementTemplates,
  formatShortDate,
  formatTimeRemaining,
  type AdminApplication,
  type AdminRequirement,
  type RequirementInput,
  type RequirementTemplate,
} from "@/src/lib/churchApplicationsApi";
import { GlassCard, RC, ReportCenterBackground, StatusPill } from "@/src/components/systemAdmin/reportCenterTheme";

type DraftRequirement = RequirementInput & { key: string };
type SheetOption = { label: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void };

const MESSAGE_ACTIONS: Record<string, { title: string; placeholder: string; button: string; required: boolean; danger?: boolean }> = {
  request_info: { title: "Request more information", placeholder: "What does the applicant need to add?", button: "Send request", required: true },
  reject: { title: "Reject application", placeholder: "Reason shown to the applicant", button: "Reject", required: true, danger: true },
  note: { title: "Add a note", placeholder: "Internal note (not shown to the applicant). The status stays the same.", button: "Save note", required: true },
  activate: { title: "Activate church", placeholder: "Optional message to the applicant", button: "Activate", required: false },
};

function dayLabel(days: number) {
  return days === 1 ? "1 day" : `${days} days`;
}

function daysUntil(iso: string) {
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));
}

function InfoRow({ label, value, color }: { label: string; value?: string; color?: string }) {
  if (!value) return null;
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, color ? { color } : null]} selectable>
        {value}
      </Text>
    </View>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <GlassCard style={s.section}>
      <Pressable onPress={onToggle} style={s.sectionHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={s.sectionTitle}>
          {title}
          {typeof count === "number" ? <Text style={s.sectionCount}>  {count}</Text> : null}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={17} color={RC.muted} />
      </Pressable>
      {open ? <View style={s.sectionBody}>{children}</View> : null}
    </GlassCard>
  );
}

function RequirementRow({ r, actionable, onPress }: { r: AdminRequirement; actionable: boolean; onPress: () => void }) {
  const done = !!r.completedAt;
  const isMembers = r.kind === "verified_members";
  const pct = done ? 1 : isMembers ? Math.min(1, Number(r.current || 0) / Math.max(1, Number(r.target || 1))) : 0;
  return (
    <Pressable onPress={onPress} disabled={!actionable} style={({ pressed }) => [s.req, pressed && { opacity: 0.8 }]}>
      <View style={s.reqTop}>
        <Ionicons name={done ? "checkmark-circle" : isMembers ? "people-outline" : "shield-checkmark-outline"} size={17} color={done ? RC.green : RC.gold} />
        <Text style={s.reqTitle} numberOfLines={2}>
          {r.title}
        </Text>
        {actionable ? <Ionicons name="ellipsis-horizontal" size={17} color={RC.muted} /> : null}
      </View>
      {isMembers ? (
        <>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${Math.round(pct * 100)}%` }, done && { backgroundColor: RC.green }]} />
          </View>
          <Text style={s.reqMeta}>
            {Number(r.current || 0)} / {r.target} members · {done ? "Completed" : `${formatTimeRemaining(r.deadlineAt)}, due ${formatShortDate(r.deadlineAt)}`}
          </Text>
        </>
      ) : (
        <Text style={s.reqMeta}>
          {done ? `Confirmed ${formatShortDate(r.completedAt)}` : `Needs confirmation · ${formatTimeRemaining(r.deadlineAt)}, due ${formatShortDate(r.deadlineAt)}`}
        </Text>
      )}
    </Pressable>
  );
}

export default function ChurchApplicationAdminDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [app, setApp] = useState<AdminApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<RequirementTemplate[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheet, setSheet] = useState<{ title: string; options: SheetOption[] } | null>(null);

  const [messageAction, setMessageAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<"approve" | "update">("approve");
  const [draft, setDraft] = useState<DraftRequirement[]>([]);
  const [activationMode, setActivationMode] = useState<"auto" | "admin_review">("admin_review");
  const [builderMessage, setBuilderMessage] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customKind, setCustomKind] = useState<"verified_members" | "manual">("verified_members");
  const [customTitle, setCustomTitle] = useState("");
  const [customTarget, setCustomTarget] = useState("12");
  const [customDays, setCustomDays] = useState("30");

  const load = useCallback(async () => {
    const res = await fetchAdminChurchApplication(String(id || ""));
    if (res.ok) {
      setApp(res.data);
      setError("");
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void fetchRequirementTemplates().then((res) => res.ok && setTemplates(res.data));
    }, [load])
  );

  const run = async (body: Parameters<typeof adminChurchApplicationAction>[1], done?: string) => {
    if (!app || busy) return false;
    setBusy(true);
    const res = await adminChurchApplicationAction(app.id, { expectedUpdatedAt: app.updatedAt, ...body });
    setBusy(false);
    if (!res.ok) {
      Alert.alert("Not saved", res.message);
      if (res.error === "conflict") void load();
      return false;
    }
    setApp(res.data);
    if (done) Alert.alert("Saved", done);
    return true;
  };

  const openBuilder = (mode: "approve" | "update") => {
    if (!app) return;
    setBuilderMode(mode);
    setBuilderMessage("");
    setCustomOpen(false);
    setActivationMode(app.activationMode || "admin_review");
    setDraft(
      mode === "update"
        ? app.requirements.map((r) => ({
            key: r.id,
            id: r.id,
            kind: r.kind,
            title: r.title,
            target: r.target,
            deadlineAt: r.deadlineAt,
            description: r.description,
            templateId: r.templateId,
          }))
        : []
    );
    setBuilderOpen(true);
  };

  const addTemplate = (t: RequirementTemplate) =>
    setDraft((d) => [
      ...d,
      { key: `${t.id}-${Date.now()}`, templateId: t.id, kind: t.kind, title: t.title, target: t.target, durationDays: t.durationDays, description: t.description },
    ]);

  const addCustom = () => {
    const days = Math.floor(Number(customDays));
    const target = Math.floor(Number(customTarget));
    if (!customTitle.trim() && customKind === "manual") {
      Alert.alert("Missing title", "Describe the requirement.");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 730) {
      Alert.alert("Deadline", "Use 1 to 730 days.");
      return;
    }
    if (customKind === "verified_members" && (!Number.isFinite(target) || target < 1)) {
      Alert.alert("Target", "Enter how many verified members are needed.");
      return;
    }
    const title = customTitle.trim() || `Reach ${target} verified members within ${dayLabel(days)}`;
    setDraft((d) => [
      ...d,
      { key: `custom-${Date.now()}`, kind: customKind, title, target: customKind === "verified_members" ? target : undefined, durationDays: days },
    ]);
    setCustomTitle("");
  };

  const saveCustomAsTemplate = async () => {
    const days = Math.floor(Number(customDays));
    const target = Math.floor(Number(customTarget));
    const title = customTitle.trim() || (customKind === "verified_members" ? `Reach ${target} verified members` : "");
    const res = await createRequirementTemplate({
      kind: customKind,
      title,
      target: customKind === "verified_members" ? target : undefined,
      durationDays: days,
    });
    if (!res.ok) {
      Alert.alert("Template not saved", res.message);
      return;
    }
    setTemplates((t) => [...t, res.data]);
    Alert.alert("Template saved", `"${res.data.title}" can now be reused.`);
  };

  const removeTemplate = (t: RequirementTemplate) => {
    if (t.builtin) return;
    Alert.alert("Delete template", `Delete "${t.title}"? Requirements already given to churches stay.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const res = await deleteRequirementTemplate(t.id);
          if (res.ok) setTemplates((list) => list.filter((x) => x.id !== t.id));
          else Alert.alert("Not deleted", res.message);
        },
      },
    ]);
  };

  const saveBuilder = async () => {
    const requirements: RequirementInput[] = draft.map(({ key: _key, ...r }) => r);
    const ok = await run(
      {
        action: builderMode === "approve" ? "approve" : "update_requirements",
        requirements,
        activationMode,
        message: builderMessage.trim() || undefined,
      },
      builderMode === "approve" ? "Approved on conditions. The church was created in a hidden pending state." : "Requirements updated."
    );
    if (ok) setBuilderOpen(false);
  };

  const extendOptions = (requirementId: string, currentDeadline: string): SheetOption[] =>
    [7, 14, 30].map((days) => ({
      label: `Extend by ${dayLabel(days)}`,
      icon: "calendar-outline" as const,
      onPress: () => {
        const base = Math.max(Date.now(), Date.parse(currentDeadline));
        void run({ action: "extend_deadline", requirementId, deadlineAt: new Date(base + days * 86400000).toISOString() }, "Deadline extended.");
      },
    }));

  const openRequirementActions = (r: AdminRequirement) => {
    const options: SheetOption[] = [];
    if (r.kind === "manual") {
      options.push({
        label: "Mark as complete",
        icon: "checkmark-circle-outline",
        onPress: () => void run({ action: "complete_requirement", requirementId: r.id }),
      });
    }
    options.push(...extendOptions(r.id, r.deadlineAt));
    setSheet({ title: r.title, options });
  };

  const submitMessage = async () => {
    if (!messageAction) return;
    const cfg = MESSAGE_ACTIONS[messageAction];
    if (cfg.required && !message.trim()) {
      Alert.alert("Message needed", cfg.placeholder);
      return;
    }
    const ok = await run({ action: messageAction, message: message.trim() || undefined });
    if (ok) {
      setMessageAction(null);
      setMessage("");
    }
  };

  const header = (
    <View style={s.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={22} color={RC.text} />
      </Pressable>
      <View style={s.headerPill}>
        <MaterialCommunityIcons name="church" size={15} color={RC.purple} />
        <Text style={s.headerTitle}>Church application</Text>
      </View>
      <Pressable onPress={() => void load()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Refresh">
        <Ionicons name="refresh" size={18} color={RC.gold} />
      </Pressable>
    </View>
  );

  if (loading || !app) {
    return (
      <View style={[s.safe, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ReportCenterBackground />
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={RC.gold} /> : <Text style={s.muted}>{error || "Application not found"}</Text>}
        </View>
      </View>
    );
  }

  const canDecide = app.status === "pending_review" || app.status === "more_info_needed";
  const inRequirements = ["conditionally_approved", "requirements_in_progress", "expired"].includes(app.status);
  const ready = app.status === "ready_for_admin_review";
  const canReject = !["active", "rejected"].includes(app.status);

  // One clear primary action per status; everything else lives under "More".
  const primary: { label: string; onPress: () => void } | null = canDecide
    ? { label: "Approve with requirements", onPress: () => openBuilder("approve") }
    : ready
      ? { label: "Activate church", onPress: () => setMessageAction("activate") }
      : inRequirements
        ? { label: "Change requirements", onPress: () => openBuilder("update") }
        : null;
  const more: SheetOption[] = [
    ...(canDecide ? [{ label: "Request more information", icon: "help-circle-outline" as const, onPress: () => setMessageAction("request_info") }] : []),
    ...(ready ? [{ label: "Change requirements", icon: "list-outline" as const, onPress: () => openBuilder("update") }] : []),
    ...(inRequirements && app.requirements.some((r) => !r.completedAt)
      ? [
          {
            label: "Extend all open deadlines",
            icon: "calendar-outline" as const,
            onPress: () => {
              const open = app.requirements.filter((r) => !r.completedAt);
              const latest = open.reduce((m, r) => Math.max(m, Date.parse(r.deadlineAt)), 0);
              setTimeout(() => setSheet({ title: "Extend all open deadlines", options: extendOptions("all", new Date(latest).toISOString()) }), 250);
            },
          },
        ]
      : []),
    { label: canDecide ? "Keep pending — add note" : "Add note", icon: "create-outline" as const, onPress: () => setMessageAction("note") },
    ...(canReject ? [{ label: "Reject application", icon: "close-circle-outline" as const, danger: true, onPress: () => setMessageAction("reject") }] : []),
  ];

  return (
    <View style={[s.safe, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ReportCenterBackground />
      {header}

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 120 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <GlassCard style={s.hero} borderColor={app.needsReview ? "rgba(244,208,111,0.42)" : RC.line}>
          <Text style={s.title}>{app.church.name}</Text>
          <Text style={s.muted}>{[app.church.city, app.church.province, app.church.country].filter(Boolean).join(", ")}</Text>
          <View style={{ marginTop: 12 }}>
            <StatusPill status={app.status} label={app.statusLabel} />
          </View>
          <View style={s.facts}>
            <Fact label="Submitted" value={formatShortDate(app.submittedAt)} />
            <Fact label="Source" value={app.source === "agent" ? "Agent" : "Direct"} color={app.source === "agent" ? RC.purple : undefined} />
            <Fact label="Church ID" value={app.churchId || "—"} color={app.churchId ? RC.gold : undefined} />
          </View>
          <Text style={s.applicantLine} numberOfLines={1}>
            {app.applicantName}
            {app.applicantKristoId ? ` · ${app.applicantKristoId}` : ""}
          </Text>
          {app.agent ? (
            <Text style={s.agentLine} numberOfLines={1}>
              Via agent {app.agent.agentName || app.agent.agentKristoId} · {app.agent.agentCode}
            </Text>
          ) : null}
        </GlassCard>

        {app.applicantResponse && app.status === "pending_review" ? (
          <GlassCard style={s.note} borderColor="rgba(147,197,253,0.35)">
            <Text style={s.noteLabel}>Applicant's answer</Text>
            <Text style={s.noteText}>{app.applicantResponse}</Text>
          </GlassCard>
        ) : null}

        {app.requirements.length ? (
          <GlassCard style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Requirements</Text>
              <Text style={s.sectionHint}>{app.activationMode === "auto" ? "Auto-activates" : "Final review"}</Text>
            </View>
            <View style={s.sectionBody}>
              {app.requirements.map((r) => (
                <RequirementRow key={r.id} r={r} actionable={inRequirements && !r.completedAt} onPress={() => openRequirementActions(r)} />
              ))}
            </View>
          </GlassCard>
        ) : null}

        <Section title="Details" open={detailsOpen} onToggle={() => setDetailsOpen((v) => !v)}>
          <InfoRow label="Application" value={app.id} />
          <InfoRow label="Applicant" value={app.applicantName} />
          <InfoRow label="Kristo ID" value={app.applicantKristoId} />
          <InfoRow label="User" value={app.applicantUserId} />
          <InfoRow label="Phone" value={app.church.phone} />
          <InfoRow label="Address" value={app.church.address} />
          <InfoRow label="Activation" value={app.activationMode === "auto" ? "Automatic when requirements are met" : "Final admin review"} />
          {app.applicantResponse && app.status !== "pending_review" ? <InfoRow label="Last answer" value={app.applicantResponse} /> : null}
          {app.agent ? (
            <View style={s.agentBox}>
              <Text style={s.agentTitle}>Submitted through an agent</Text>
              <InfoRow label="Agent" value={app.agent.agentName} />
              <InfoRow label="Agent ID" value={app.agent.agentKristoId} />
              <InfoRow label="Registration" value={app.agent.agentRegistrationId} />
              <InfoRow label="Agent code" value={app.agent.agentCode} color={RC.gold} />
              <InfoRow label="Submitted" value={formatShortDate(app.agent.submittedAt)} />
              <InfoRow
                label="Code"
                value={
                  app.agent.codeRedeemedAt
                    ? `Redeemed for ${app.churchId} on ${formatShortDate(app.agent.codeRedeemedAt)}`
                    : app.agent.codeRedeemError
                      ? `Not redeemed: ${app.agent.codeRedeemError}`
                      : "Reserved; redeemed when the church is created"
                }
                color={app.agent.codeRedeemError ? RC.red : undefined}
              />
            </View>
          ) : null}
        </Section>

        <Section title="History" count={app.history.length} open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)}>
          {[...app.history].reverse().map((e, i) => (
            <View key={`${e.at}-${i}`} style={[s.event, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={s.eventTitle}>
                {e.type.replace(/_/g, " ")}
                {e.toStatus ? ` → ${e.toStatus.replace(/_/g, " ")}` : ""}
              </Text>
              <Text style={s.eventMeta}>
                {new Date(e.at).toLocaleString()} · {e.byRole}
                {e.byUserId !== "system" ? ` ${e.byUserId}` : ""}
              </Text>
              {e.message ? <Text style={s.eventMsg}>{e.message}</Text> : null}
              {e.details ? (
                <Text style={s.eventDetails} numberOfLines={6}>
                  {Object.entries(e.details)
                    .filter(([, v]) => v !== undefined && v !== null && v !== "")
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : String(v)}`)
                    .join("\n")}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      </ScrollView>

      {/* Action bar: one primary action, the rest under More. */}
      <View style={[s.actionBar, { paddingBottom: 12 + insets.bottom }]}>
        {primary ? (
          <Pressable disabled={busy} onPress={primary.onPress} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.9 }]}>
            {busy ? <ActivityIndicator color="#0B0F17" /> : <Text style={s.primaryText}>{primary.label}</Text>}
          </Pressable>
        ) : (
          <View style={[s.primaryBtn, s.primaryDone]}>
            <Text style={[s.primaryText, { color: RC.muted }]}>{app.status === "active" ? "Church is active" : "Application closed"}</Text>
          </View>
        )}
        <Pressable
          disabled={busy}
          onPress={() => setSheet({ title: "More actions", options: more })}
          style={({ pressed }) => [s.moreBtn, pressed && { opacity: 0.85 }]}
          accessibilityLabel="More actions"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={RC.text} />
        </Pressable>
      </View>

      {/* Action sheet */}
      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <View style={s.modalWrap}>
          <Pressable style={s.backdrop} onPress={() => setSheet(null)} />
          {sheet ? (
            <View style={[s.sheet, { paddingBottom: 14 + insets.bottom }]}>
              <View style={s.handle} />
              <Text style={s.sheetTitle} numberOfLines={2}>
                {sheet.title}
              </Text>
              {sheet.options.map((o) => (
                <Pressable
                  key={o.label}
                  onPress={() => {
                    setSheet(null);
                    o.onPress();
                  }}
                  style={({ pressed }) => [s.sheetRow, pressed && { backgroundColor: "rgba(255,255,255,0.05)" }]}
                >
                  <Ionicons name={o.icon} size={19} color={o.danger ? RC.red : RC.gold} />
                  <Text style={[s.sheetRowText, o.danger && { color: RC.red }]}>{o.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setSheet(null)} style={s.sheetCancel}>
                <Text style={s.sheetCancelText}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Message actions: request info / reject / note / activate */}
      <Modal visible={!!messageAction} transparent animationType="fade" onRequestClose={() => setMessageAction(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.modalWrap}>
          <Pressable style={s.backdrop} onPress={() => setMessageAction(null)} />
          {messageAction ? (
            <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>{MESSAGE_ACTIONS[messageAction].title}</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={MESSAGE_ACTIONS[messageAction].placeholder}
                placeholderTextColor={RC.faint}
                multiline
                maxLength={1000}
                style={[s.input, { minHeight: 96 }]}
              />
              <View style={s.btnRow}>
                <Pressable onPress={() => setMessageAction(null)} style={[s.btn, { flex: 1 }]}>
                  <Text style={s.btnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void submitMessage()}
                  style={[s.btn, { flex: 1 }, MESSAGE_ACTIONS[messageAction].danger ? s.btnDanger : s.btnPrimary]}
                >
                  <Text style={[s.btnText, MESSAGE_ACTIONS[messageAction].danger ? { color: RC.red } : { color: "#0B0F17" }]}>
                    {MESSAGE_ACTIONS[messageAction].button}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>

      {/* Requirement builder: approve conditionally / change requirements */}
      <Modal visible={builderOpen} animationType="slide" onRequestClose={() => setBuilderOpen(false)}>
        <View style={[s.safe, { paddingTop: insets.top }]}>
          <ReportCenterBackground />
          <View style={s.header}>
            <Pressable onPress={() => setBuilderOpen(false)} hitSlop={10} style={s.headerBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={RC.text} />
            </Pressable>
            <View style={s.headerPill}>
              <Text style={s.headerTitle}>{builderMode === "approve" ? "Approve with requirements" : "Change requirements"}</Text>
            </View>
            <View style={{ width: 44 }} />
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={[s.content, { paddingBottom: 30 }]} keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Requirements</Text>
              {!draft.length ? (
                <Text style={[s.muted, { marginBottom: 12 }]}>
                  None yet. Without requirements the church {activationMode === "auto" ? "opens right away" : "goes straight to final review"}.
                </Text>
              ) : null}
              {draft.map((r) => (
                <GlassCard key={r.key} style={s.draft}>
                  <View style={s.reqTop}>
                    <Ionicons name={r.kind === "verified_members" ? "people-outline" : "shield-checkmark-outline"} size={16} color={RC.gold} />
                    <Text style={s.reqTitle}>{r.title}</Text>
                    <Pressable onPress={() => setDraft((d) => d.filter((x) => x.key !== r.key))} hitSlop={8} accessibilityLabel="Remove requirement">
                      <Ionicons name="trash-outline" size={17} color={RC.red} />
                    </Pressable>
                  </View>
                  <View style={s.inline}>
                    {r.kind === "verified_members" ? (
                      <>
                        <TextInput
                          value={String(r.target ?? "")}
                          onChangeText={(v) => setDraft((d) => d.map((x) => (x.key === r.key ? { ...x, target: Number(v.replace(/\D/g, "")) || undefined } : x)))}
                          keyboardType="number-pad"
                          style={[s.input, s.small]}
                        />
                        <Text style={s.muted}>members in</Text>
                      </>
                    ) : (
                      <Text style={s.muted}>Within</Text>
                    )}
                    <TextInput
                      value={String(r.durationDays ?? (r.deadlineAt ? daysUntil(r.deadlineAt) : ""))}
                      onChangeText={(v) =>
                        setDraft((d) =>
                          d.map((x) => (x.key === r.key ? { ...x, durationDays: Number(v.replace(/\D/g, "")) || undefined, deadlineAt: undefined } : x))
                        )
                      }
                      keyboardType="number-pad"
                      style={[s.input, s.small]}
                    />
                    <Text style={s.muted}>days</Text>
                  </View>
                </GlassCard>
              ))}

              <Text style={s.label}>Add from templates</Text>
              <View style={s.templates}>
                {templates.map((t) => (
                  <Pressable key={t.id} onPress={() => addTemplate(t)} onLongPress={() => removeTemplate(t)} style={s.template}>
                    <Ionicons name="add" size={14} color={RC.gold} />
                    <Text style={s.templateText}>
                      {t.title} · {dayLabel(t.durationDays)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[s.hint, { marginBottom: 8 }]}>Long-press a custom template to delete it.</Text>

              <Pressable onPress={() => setCustomOpen((v) => !v)} style={s.customToggle}>
                <Ionicons name={customOpen ? "remove" : "add"} size={16} color={RC.gold} />
                <Text style={s.customToggleText}>Custom requirement</Text>
              </Pressable>
              {customOpen ? (
                <GlassCard style={s.draft}>
                  <View style={s.segment}>
                    {(["verified_members", "manual"] as const).map((k) => (
                      <Pressable key={k} onPress={() => setCustomKind(k)} style={[s.seg, customKind === k && s.segOn]}>
                        <Text style={[s.segText, customKind === k && { color: RC.gold }]}>{k === "verified_members" ? "Verified members" : "Admin confirms"}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    value={customTitle}
                    onChangeText={setCustomTitle}
                    placeholder={customKind === "verified_members" ? "Title (optional)" : "e.g. Church building photos received"}
                    placeholderTextColor={RC.faint}
                    style={[s.input, { marginTop: 10 }]}
                  />
                  <View style={s.inline}>
                    {customKind === "verified_members" ? (
                      <>
                        <TextInput value={customTarget} onChangeText={setCustomTarget} keyboardType="number-pad" style={[s.input, s.small]} />
                        <Text style={s.muted}>members in</Text>
                      </>
                    ) : (
                      <Text style={s.muted}>Within</Text>
                    )}
                    <TextInput value={customDays} onChangeText={setCustomDays} keyboardType="number-pad" style={[s.input, s.small]} />
                    <Text style={s.muted}>days</Text>
                  </View>
                  <View style={s.btnRow}>
                    <Pressable onPress={addCustom} style={[s.btn, { flex: 1 }]}>
                      <Text style={[s.btnText, { color: RC.gold }]}>Add</Text>
                    </Pressable>
                    <Pressable onPress={() => void saveCustomAsTemplate()} style={[s.btn, { flex: 1 }]}>
                      <Text style={s.btnText}>Save as template</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              ) : null}

              <Text style={s.label}>When requirements are complete</Text>
              <View style={s.segment}>
                {(["auto", "admin_review"] as const).map((m) => (
                  <Pressable key={m} onPress={() => setActivationMode(m)} style={[s.seg, activationMode === m && s.segOn]}>
                    <Text style={[s.segText, activationMode === m && { color: RC.gold }]}>{m === "auto" ? "Activate automatically" : "Final admin review"}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.label}>Message to the applicant</Text>
              <TextInput
                value={builderMessage}
                onChangeText={setBuilderMessage}
                placeholder="Optional"
                placeholderTextColor={RC.faint}
                multiline
                maxLength={1000}
                style={[s.input, { minHeight: 72 }]}
              />
            </ScrollView>
          </KeyboardAvoidingView>
          <View style={[s.actionBar, { paddingBottom: 12 + insets.bottom }]}>
            <Pressable disabled={busy} onPress={() => void saveBuilder()} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.9 }]}>
              {busy ? (
                <ActivityIndicator color="#0B0F17" />
              ) : (
                <Text style={s.primaryText}>
                  {builderMode === "approve" ? `Approve${draft.length ? ` with ${draft.length} requirement${draft.length > 1 ? "s" : ""}` : ""}` : "Save requirements"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: RC.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: RC.line,
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  headerPill: {
    flex: 1,
    height: 44,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.4)",
    backgroundColor: "rgba(124,92,210,0.12)",
  },
  headerTitle: { color: "#E9DDFF", fontSize: 14, fontWeight: "900" },
  content: { paddingHorizontal: 16, paddingTop: 6, gap: 12 },
  hero: { padding: 18 },
  title: { color: RC.text, fontSize: 22, fontWeight: "900" },
  muted: { color: RC.muted, fontSize: 13, fontWeight: "700", marginTop: 2 },
  facts: { flexDirection: "row", marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RC.line, paddingTop: 12 },
  fact: { flex: 1, gap: 3 },
  factLabel: { color: RC.faint, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  factValue: { color: RC.text, fontSize: 13.5, fontWeight: "900" },
  applicantLine: { color: RC.muted, fontSize: 12.5, fontWeight: "700", marginTop: 12 },
  agentLine: { color: RC.purple, fontSize: 12.5, fontWeight: "800", marginTop: 4 },
  note: { padding: 14 },
  noteLabel: { color: RC.blue, fontSize: 12, fontWeight: "900", marginBottom: 4 },
  noteText: { color: RC.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  section: { paddingHorizontal: 16 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52 },
  sectionTitle: { color: RC.gold, fontSize: 15, fontWeight: "900", letterSpacing: 0.4 },
  sectionCount: { color: RC.faint, fontSize: 13, fontWeight: "900" },
  sectionHint: { color: RC.faint, fontSize: 12, fontWeight: "800" },
  sectionBody: { paddingBottom: 14, gap: 4 },
  req: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RC.line },
  reqTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  reqTitle: { flex: 1, color: RC.text, fontSize: 14, fontWeight: "900" },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 10, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: RC.purple },
  reqMeta: { color: RC.muted, fontSize: 12, fontWeight: "700", marginTop: 7 },
  infoRow: { flexDirection: "row", gap: 10, paddingVertical: 5 },
  infoLabel: { width: 96, color: RC.faint, fontSize: 12.5, fontWeight: "800" },
  infoValue: { flex: 1, color: RC.text, fontSize: 13, fontWeight: "800" },
  agentBox: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RC.line },
  agentTitle: { color: RC.purple, fontSize: 12.5, fontWeight: "900", marginBottom: 4 },
  event: { paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RC.line },
  eventTitle: { color: RC.text, fontSize: 13, fontWeight: "900", textTransform: "capitalize" },
  eventMeta: { color: RC.faint, fontSize: 11.5, fontWeight: "700", marginTop: 2 },
  eventMsg: { color: "rgba(255,255,255,0.84)", fontSize: 13, marginTop: 4, fontWeight: "600" },
  eventDetails: { color: "rgba(255,255,255,0.46)", fontSize: 11.5, marginTop: 4, fontWeight: "600" },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "rgba(8,12,20,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RC.line,
  },
  primaryBtn: { flex: 1, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: RC.gold },
  primaryDone: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: RC.line },
  primaryText: { color: "#0B0F17", fontSize: 15, fontWeight: "900" },
  moreBtn: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: RC.line,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
    backgroundColor: "#111321",
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 },
  sheetTitle: { color: RC.text, fontSize: 16, fontWeight: "900", marginBottom: 8, paddingHorizontal: 4 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 6, borderRadius: 12 },
  sheetRowText: { color: RC.text, fontSize: 15, fontWeight: "800" },
  sheetCancel: { marginTop: 8, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: RC.line },
  sheetCancelText: { color: RC.muted, fontSize: 14, fontWeight: "900" },
  input: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: RC.line,
    backgroundColor: "rgba(255,255,255,0.05)",
    color: RC.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    textAlignVertical: "top",
  },
  small: { width: 60, textAlign: "center", paddingVertical: 6 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  btn: { height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: RC.line },
  btnPrimary: { backgroundColor: RC.gold, borderColor: RC.gold },
  btnDanger: { borderColor: "rgba(251,113,133,0.55)", backgroundColor: "rgba(251,113,133,0.08)" },
  btnText: { color: RC.text, fontSize: 14, fontWeight: "900" },
  label: { color: RC.gold, fontSize: 13, fontWeight: "900", letterSpacing: 0.5, marginTop: 8 },
  hint: { color: RC.faint, fontSize: 12, fontWeight: "700" },
  draft: { padding: 14 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  templates: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  template: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
    backgroundColor: "rgba(244,208,111,0.07)",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  templateText: { color: RC.text, fontSize: 12.5, fontWeight: "800" },
  customToggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6 },
  customToggleText: { color: RC.gold, fontSize: 13.5, fontWeight: "900" },
  segment: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: RC.line, paddingHorizontal: 6 },
  segOn: { borderColor: "rgba(244,208,111,0.5)", backgroundColor: "rgba(244,208,111,0.12)" },
  segText: { color: RC.muted, fontSize: 12.5, fontWeight: "900", textAlign: "center" },
});
