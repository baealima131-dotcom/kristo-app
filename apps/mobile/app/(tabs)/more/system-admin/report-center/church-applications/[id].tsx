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
  CHURCH_APPLICATION_STATUS_COLORS,
  adminChurchApplicationAction,
  createRequirementTemplate,
  deleteRequirementTemplate,
  fetchAdminChurchApplication,
  fetchRequirementTemplates,
  formatShortDate,
  formatTimeRemaining,
  type AdminApplication,
  type RequirementInput,
  type RequirementTemplate,
} from "@/src/lib/churchApplicationsApi";

const BG = "#0A0716";
const GOLD = "#F4D06F";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.6)";
const RED = "#FB7185";
const GREEN = "#86EFAC";
const BLUE = "#93C5FD";
const PURPLE = "#C4B5FD";

type DraftRequirement = RequirementInput & { key: string };

const MESSAGE_ACTIONS: Record<string, { title: string; placeholder: string; button: string; required: boolean; danger?: boolean }> = {
  request_info: { title: "Request more information", placeholder: "What does the applicant need to add?", button: "Send request", required: true },
  reject: { title: "Reject application", placeholder: "Reason shown to the applicant", button: "Reject", required: true, danger: true },
  note: { title: "Keep pending — add a note", placeholder: "Internal note (not shown to the applicant)", button: "Save note", required: true },
  activate: { title: "Activate church", placeholder: "Optional message to the applicant", button: "Activate", required: false },
};

function dayLabel(days: number) {
  return days === 1 ? "1 day" : `${days} days`;
}

function daysUntil(iso: string) {
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));
}

function Row({ label, value, color }: { label: string; value?: string; color?: string }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, color ? { color } : null]} selectable>
        {value}
      </Text>
    </View>
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

  const [messageAction, setMessageAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<"approve" | "update">("approve");
  const [draft, setDraft] = useState<DraftRequirement[]>([]);
  const [activationMode, setActivationMode] = useState<"auto" | "admin_review">("admin_review");
  const [builderMessage, setBuilderMessage] = useState("");
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
    const title =
      customTitle.trim() || `Reach ${target} verified members within ${dayLabel(days)}`;
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

  const extend = (requirementId: string, currentDeadline: string) => {
    const options = [7, 14, 30];
    Alert.alert("Extend deadline", "Add time from the current deadline.", [
      ...options.map((days) => ({
        text: `+${dayLabel(days)}`,
        onPress: () => {
          const base = Math.max(Date.now(), Date.parse(currentDeadline));
          void run(
            { action: "extend_deadline", requirementId, deadlineAt: new Date(base + days * 86400000).toISOString() },
            "Deadline extended."
          );
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
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

  if (loading) {
    return (
      <View style={[s.safe, s.center]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  const color = app ? CHURCH_APPLICATION_STATUS_COLORS[app.status] || GOLD : GOLD;
  const canDecide = app && (app.status === "pending_review" || app.status === "more_info_needed");
  const inRequirements = app && ["conditionally_approved", "requirements_in_progress", "expired"].includes(app.status);
  const ready = app?.status === "ready_for_admin_review";
  const canReject = app && !["active", "rejected"].includes(app.status);

  return (
    <View style={[s.safe, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>
          Church application
        </Text>
        <Pressable onPress={() => void load()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Refresh">
          <Ionicons name="refresh" size={18} color={GOLD} />
        </Pressable>
      </View>

      {!app ? (
        <View style={s.center}>
          <Text style={s.muted}>{error || "Application not found"}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: 60 + insets.bottom }]}>
          <View style={s.card}>
            <View style={s.cardTop}>
              <View style={s.icon}>
                <MaterialCommunityIcons name="church" size={22} color={GOLD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{app.church.name}</Text>
                <Text style={s.muted}>{[app.church.city, app.church.province, app.church.country].filter(Boolean).join(", ")}</Text>
              </View>
            </View>
            <View style={[s.status, { borderColor: color, backgroundColor: `${color}1F` }]}>
              <Text style={[s.statusText, { color }]}>{app.statusLabel}</Text>
            </View>
            <Row label="Application" value={app.id} />
            <Row label="Church ID" value={app.churchId} color={GOLD} />
            <Row label="Phone" value={app.church.phone} />
            <Row label="Address" value={app.church.address} />
            <Row label="Submitted" value={formatShortDate(app.submittedAt)} />
            <Row label="Activation" value={app.activationMode === "auto" ? "Automatic when requirements are met" : "Final admin review"} />
          </View>

          <Text style={s.section}>Applicant</Text>
          <View style={s.card}>
            <Row label="Name" value={app.applicantName} />
            <Row label="Kristo ID" value={app.applicantKristoId} />
            <Row label="User" value={app.applicantUserId} />
            {app.applicantResponse ? <Row label="Last answer" value={app.applicantResponse} /> : null}
          </View>

          <Text style={s.section}>Source</Text>
          <View style={[s.card, app.source === "agent" && { borderColor: "rgba(196,181,253,0.45)" }]}>
            <View style={s.cardTop}>
              <Ionicons name={app.source === "agent" ? "id-card-outline" : "person-outline"} size={18} color={app.source === "agent" ? PURPLE : BLUE} />
              <Text style={[s.rowValue, { color: app.source === "agent" ? PURPLE : BLUE }]}>
                {app.source === "agent" ? "Submitted through an agent" : "Submitted directly by the church applicant"}
              </Text>
            </View>
            {app.agent ? (
              <View style={{ marginTop: 8 }}>
                <Row label="Agent" value={app.agent.agentName} />
                <Row label="Agent ID" value={app.agent.agentKristoId} />
                <Row label="Registration" value={app.agent.agentRegistrationId} />
                <Row label="Agent code" value={app.agent.agentCode} color={GOLD} />
                <Row label="Submitted" value={formatShortDate(app.agent.submittedAt)} />
                <Row
                  label="Code"
                  value={
                    app.agent.codeRedeemedAt
                      ? `Redeemed for ${app.churchId} on ${formatShortDate(app.agent.codeRedeemedAt)}`
                      : app.agent.codeRedeemError
                        ? `Not redeemed: ${app.agent.codeRedeemError}`
                        : "Reserved; redeemed when the church is created"
                  }
                  color={app.agent.codeRedeemError ? RED : undefined}
                />
              </View>
            ) : null}
          </View>

          {app.requirements.length ? (
            <>
              <Text style={s.section}>Requirements</Text>
              {app.requirements.map((r) => {
                const done = !!r.completedAt;
                const isMembers = r.kind === "verified_members";
                return (
                  <View key={r.id} style={[s.card, done && { borderColor: "rgba(134,239,172,0.45)" }]}>
                    <View style={s.cardTop}>
                      <Ionicons name={done ? "checkmark-circle" : isMembers ? "people-outline" : "shield-checkmark-outline"} size={18} color={done ? GREEN : GOLD} />
                      <Text style={[s.rowValue, { flex: 1 }]}>{r.title}</Text>
                    </View>
                    {isMembers ? (
                      <Text style={[s.progress, done && { color: GREEN }]}>
                        {Number(r.current || 0)} / {r.target} verified members
                      </Text>
                    ) : (
                      <Text style={s.muted}>{done ? `Confirmed ${formatShortDate(r.completedAt)}` : "Needs admin confirmation"}</Text>
                    )}
                    <Text style={[s.muted, { marginTop: 4 }]}>
                      {done ? "Completed" : `${formatTimeRemaining(r.deadlineAt)} • due ${formatShortDate(r.deadlineAt)}`}
                    </Text>
                    {!done && inRequirements ? (
                      <View style={s.inlineActions}>
                        {!isMembers ? (
                          <Pressable
                            onPress={() =>
                              Alert.alert("Confirm requirement", `Mark "${r.title}" as complete?`, [
                                { text: "Cancel", style: "cancel" },
                                { text: "Confirm", onPress: () => void run({ action: "complete_requirement", requirementId: r.id }) },
                              ])
                            }
                            style={s.smallBtn}
                          >
                            <Text style={s.smallBtnText}>Confirm</Text>
                          </Pressable>
                        ) : null}
                        <Pressable onPress={() => extend(r.id, r.deadlineAt)} style={s.smallBtn}>
                          <Text style={s.smallBtnText}>Extend</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          <Text style={s.section}>Decision</Text>
          <View style={s.actions}>
            {canDecide ? (
              <Pressable disabled={busy} onPress={() => openBuilder("approve")} style={[s.actionBtn, s.goldBtn]}>
                <Text style={s.goldBtnText}>Approve conditionally</Text>
              </Pressable>
            ) : null}
            {ready ? (
              <Pressable disabled={busy} onPress={() => setMessageAction("activate")} style={[s.actionBtn, s.goldBtn]}>
                <Text style={s.goldBtnText}>Activate church</Text>
              </Pressable>
            ) : null}
            {inRequirements || ready ? (
              <Pressable disabled={busy} onPress={() => openBuilder("update")} style={s.actionBtn}>
                <Text style={s.actionText}>Change requirements</Text>
              </Pressable>
            ) : null}
            {canDecide ? (
              <Pressable disabled={busy} onPress={() => setMessageAction("request_info")} style={s.actionBtn}>
                <Text style={s.actionText}>Request more information</Text>
              </Pressable>
            ) : null}
            <Pressable disabled={busy} onPress={() => setMessageAction("note")} style={s.actionBtn}>
              <Text style={s.actionText}>{canDecide ? "Leave pending (add note)" : "Add note"}</Text>
            </Pressable>
            {canReject ? (
              <Pressable disabled={busy} onPress={() => setMessageAction("reject")} style={[s.actionBtn, s.dangerBtn]}>
                <Text style={[s.actionText, { color: RED }]}>Reject</Text>
              </Pressable>
            ) : null}
          </View>
          {busy ? <ActivityIndicator color={GOLD} style={{ marginBottom: 10 }} /> : null}

          <Text style={s.section}>Audit trail</Text>
          <View style={s.card}>
            {[...app.history].reverse().map((e, i) => (
              <View key={`${e.at}-${i}`} style={s.event}>
                <Text style={s.eventTitle}>
                  {e.type.replace(/_/g, " ")}
                  {e.toStatus ? ` → ${e.toStatus.replace(/_/g, " ")}` : ""}
                </Text>
                <Text style={s.muted}>
                  {new Date(e.at).toLocaleString()} • {e.byRole} {e.byUserId !== "system" ? e.byUserId : ""}
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
          </View>
        </ScrollView>
      )}

      {/* Message actions: request info / reject / note / activate */}
      <Modal visible={!!messageAction} transparent animationType="fade" onRequestClose={() => setMessageAction(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.modalWrap}>
          <Pressable style={s.backdrop} onPress={() => setMessageAction(null)} />
          {messageAction ? (
            <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
              <Text style={s.sheetTitle}>{MESSAGE_ACTIONS[messageAction].title}</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={MESSAGE_ACTIONS[messageAction].placeholder}
                placeholderTextColor="rgba(255,255,255,0.35)"
                multiline
                maxLength={1000}
                style={[s.input, { minHeight: 100 }]}
              />
              <View style={s.sheetBtns}>
                <Pressable onPress={() => setMessageAction(null)} style={[s.actionBtn, { flex: 1 }]}>
                  <Text style={s.actionText}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void submitMessage()}
                  style={[s.actionBtn, { flex: 1 }, MESSAGE_ACTIONS[messageAction].danger ? s.dangerBtn : s.goldBtn]}
                >
                  <Text style={MESSAGE_ACTIONS[messageAction].danger ? [s.actionText, { color: RED }] : s.goldBtnText}>
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
          <View style={s.header}>
            <Pressable onPress={() => setBuilderOpen(false)} hitSlop={10} style={s.headerBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={TEXT} />
            </Pressable>
            <Text style={s.headerTitle} numberOfLines={1}>
              {builderMode === "approve" ? "Approve with requirements" : "Change requirements"}
            </Text>
            <View style={s.headerBtn} />
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={[s.content, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
              <Text style={s.section}>Requirements for this church</Text>
              {!draft.length ? (
                <Text style={[s.muted, { marginBottom: 10 }]}>
                  No requirements: the church {activationMode === "auto" ? "opens right away" : "goes straight to your final review"}.
                </Text>
              ) : null}
              {draft.map((r) => (
                <View key={r.key} style={s.card}>
                  <View style={s.cardTop}>
                    <Ionicons name={r.kind === "verified_members" ? "people-outline" : "shield-checkmark-outline"} size={17} color={GOLD} />
                    <Text style={[s.rowValue, { flex: 1 }]}>{r.title}</Text>
                    <Pressable onPress={() => setDraft((d) => d.filter((x) => x.key !== r.key))} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={RED} />
                    </Pressable>
                  </View>
                  {r.kind === "verified_members" ? (
                    <View style={s.inlineFields}>
                      <Text style={s.muted}>Target</Text>
                      <TextInput
                        value={String(r.target ?? "")}
                        onChangeText={(v) => setDraft((d) => d.map((x) => (x.key === r.key ? { ...x, target: Number(v.replace(/\D/g, "")) || undefined } : x)))}
                        keyboardType="number-pad"
                        style={[s.input, s.smallInput]}
                      />
                      <Text style={s.muted}>members</Text>
                    </View>
                  ) : null}
                  <View style={s.inlineFields}>
                    <Text style={s.muted}>Deadline in</Text>
                    <TextInput
                      value={String(r.durationDays ?? (r.deadlineAt ? daysUntil(r.deadlineAt) : ""))}
                      onChangeText={(v) =>
                        setDraft((d) =>
                          d.map((x) => (x.key === r.key ? { ...x, durationDays: Number(v.replace(/\D/g, "")) || undefined, deadlineAt: undefined } : x))
                        )
                      }
                      keyboardType="number-pad"
                      style={[s.input, s.smallInput]}
                    />
                    <Text style={s.muted}>days</Text>
                  </View>
                </View>
              ))}

              <Text style={s.section}>Add from templates</Text>
              <View style={s.templates}>
                {templates.map((t) => (
                  <Pressable key={t.id} onPress={() => addTemplate(t)} onLongPress={() => removeTemplate(t)} style={s.template}>
                    <Ionicons name="add" size={14} color={GOLD} />
                    <Text style={s.templateText}>
                      {t.title} • {dayLabel(t.durationDays)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[s.muted, { marginBottom: 12 }]}>Long-press a custom template to delete it.</Text>

              <Text style={s.section}>Custom requirement</Text>
              <View style={s.card}>
                <View style={s.segment}>
                  {(["verified_members", "manual"] as const).map((k) => (
                    <Pressable key={k} onPress={() => setCustomKind(k)} style={[s.segBtn, customKind === k && s.segBtnOn]}>
                      <Text style={[s.segText, customKind === k && { color: GOLD }]}>{k === "verified_members" ? "Verified members" : "Admin confirms"}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={customTitle}
                  onChangeText={setCustomTitle}
                  placeholder={customKind === "verified_members" ? "Title (optional)" : "e.g. Church building photos received"}
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={[s.input, { marginTop: 10 }]}
                />
                <View style={s.inlineFields}>
                  {customKind === "verified_members" ? (
                    <>
                      <TextInput value={customTarget} onChangeText={setCustomTarget} keyboardType="number-pad" style={[s.input, s.smallInput]} />
                      <Text style={s.muted}>members within</Text>
                    </>
                  ) : (
                    <Text style={s.muted}>Within</Text>
                  )}
                  <TextInput value={customDays} onChangeText={setCustomDays} keyboardType="number-pad" style={[s.input, s.smallInput]} />
                  <Text style={s.muted}>days</Text>
                </View>
                <View style={s.sheetBtns}>
                  <Pressable onPress={addCustom} style={[s.actionBtn, { flex: 1 }]}>
                    <Text style={s.actionText}>Add</Text>
                  </Pressable>
                  <Pressable onPress={() => void saveCustomAsTemplate()} style={[s.actionBtn, { flex: 1 }]}>
                    <Text style={s.actionText}>Save as template</Text>
                  </Pressable>
                </View>
              </View>

              <Text style={s.section}>When requirements are complete</Text>
              <View style={s.segment}>
                {(["auto", "admin_review"] as const).map((m) => (
                  <Pressable key={m} onPress={() => setActivationMode(m)} style={[s.segBtn, activationMode === m && s.segBtnOn]}>
                    <Text style={[s.segText, activationMode === m && { color: GOLD }]}>{m === "auto" ? "Activate automatically" : "Final admin review"}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.section}>Message to the applicant</Text>
              <TextInput
                value={builderMessage}
                onChangeText={setBuilderMessage}
                placeholder="Optional"
                placeholderTextColor="rgba(255,255,255,0.35)"
                multiline
                maxLength={1000}
                style={[s.input, { minHeight: 80 }]}
              />

              <Pressable disabled={busy} onPress={() => void saveBuilder()} style={[s.actionBtn, s.goldBtn, { marginTop: 16 }]}>
                {busy ? (
                  <ActivityIndicator color="#0B0F17" />
                ) : (
                  <Text style={s.goldBtnText}>{builderMode === "approve" ? "Approve conditionally" : "Save requirements"}</Text>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerTitle: { flex: 1, textAlign: "center", color: GOLD, fontSize: 17, fontWeight: "900" },
  content: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    borderRadius: 20,
    borderWidth: 1.3,
    borderColor: "rgba(167,139,250,0.26)",
    backgroundColor: "rgba(255,255,255,0.045)",
    padding: 14,
    marginBottom: 12,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.4)",
    backgroundColor: "rgba(244,208,111,0.1)",
  },
  title: { color: TEXT, fontSize: 18, fontWeight: "900" },
  muted: { color: MUTED, fontSize: 12.5, fontWeight: "700" },
  status: { alignSelf: "flex-start", borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5, marginTop: 12, marginBottom: 6 },
  statusText: { fontSize: 12.5, fontWeight: "900" },
  row: { flexDirection: "row", gap: 10, marginTop: 6 },
  rowLabel: { width: 96, color: MUTED, fontSize: 12.5, fontWeight: "700" },
  rowValue: { flex: 1, color: TEXT, fontSize: 13, fontWeight: "800" },
  section: { color: GOLD, fontSize: 13, fontWeight: "900", letterSpacing: 0.6, marginTop: 6, marginBottom: 8 },
  progress: { color: BLUE, fontSize: 18, fontWeight: "900", marginTop: 8 },
  inlineActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.5)",
    backgroundColor: "rgba(244,208,111,0.08)",
  },
  smallBtnText: { color: GOLD, fontSize: 12.5, fontWeight: "900" },
  actions: { gap: 8, marginBottom: 12 },
  actionBtn: {
    minHeight: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.45)",
    backgroundColor: "rgba(244,208,111,0.07)",
    paddingHorizontal: 12,
  },
  actionText: { color: GOLD, fontSize: 14, fontWeight: "900" },
  goldBtn: { backgroundColor: "#E9C46A", borderColor: "rgba(255,226,140,0.95)" },
  goldBtnText: { color: "#07101A", fontSize: 14.5, fontWeight: "900" },
  dangerBtn: { borderColor: "rgba(251,113,133,0.55)", backgroundColor: "rgba(251,113,133,0.08)" },
  event: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.08)" },
  eventTitle: { color: TEXT, fontSize: 13, fontWeight: "900", textTransform: "capitalize" },
  eventMsg: { color: "rgba(255,255,255,0.84)", fontSize: 13, marginTop: 3, fontWeight: "600" },
  eventDetails: { color: "rgba(255,255,255,0.5)", fontSize: 11.5, marginTop: 3, fontWeight: "600" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 26,
    borderWidth: 1.4,
    borderColor: "rgba(244,208,111,0.4)",
    backgroundColor: "#0F0B1F",
    padding: 16,
  },
  sheetTitle: { color: GOLD, fontSize: 17, fontWeight: "900", marginBottom: 10 },
  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  input: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    color: TEXT,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    textAlignVertical: "top",
  },
  smallInput: { width: 64, textAlign: "center", paddingVertical: 6 },
  inlineFields: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  templates: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  template: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.4)",
    backgroundColor: "rgba(244,208,111,0.07)",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  templateText: { color: TEXT, fontSize: 12.5, fontWeight: "800" },
  segment: { flexDirection: "row", gap: 8 },
  segBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 6,
  },
  segBtnOn: { borderColor: "rgba(244,208,111,0.55)", backgroundColor: "rgba(244,208,111,0.12)" },
  segText: { color: MUTED, fontSize: 12.5, fontWeight: "900", textAlign: "center" },
});
