import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  getAdminProtectionCase,
  postAdminProtectionAction,
  SokoProtectionAdminApiError,
  type SokoProtectionAdminCase,
  type SokoProtectionAdminEvent,
} from "@/src/lib/sokoProtectionAdminApi";
import {
  adminActionLabel,
  adminActionsForState,
  deadlineStatusLabel,
  evidenceBelongsToCase,
  frozenProductTitle,
  CURRENT_ORDER_STATUS_LABEL,
  ORDER_AT_CASE_OPENING_LABEL,
  currentOrderStatusDisplay,
  orderAtCaseOpeningDisplay,
  requireAdminActionNote,
  canConfirmAdminNote,
  paymentClaimLabelText,
  paymentVerificationKindLabel,
  protectionCaseStateLabel,
  protectionEventLabel,
  protectionRequestTypeLabel,
  resolutionCodeLabel,
  shortUserRef,
  sortProtectionEventsChronologically,
  SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER,
  SOKO_PROTECTION_ADMIN_RESOLUTION_CODES,
  type SokoProtectionAdminAction,
  type SokoProtectionResolutionCode,
} from "@/src/lib/sokoProtectionAdminLabels";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const PINK = "#FF8CC8";
const GREEN = "#5DEBA5";

function formatWhen(value?: string | null) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "—";
}

function sellerResponseFromEvents(events: SokoProtectionAdminEvent[]) {
  const hit = [...events]
    .reverse()
    .find((event) => event.eventType === "seller_responded");
  if (!hit) return null;
  const meta = hit.metadata || {};
  return {
    kind: String(meta.responseKind || ""),
    note: String(meta.note || ""),
    at: hit.createdAt,
  };
}

export default function BuyerProtectionAdminCaseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ caseId?: string }>();
  const caseId = String(params.caseId || "").trim();

  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [actionPending, setActionPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [unauthorized, setUnauthorized] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [row, setRow] = React.useState<SokoProtectionAdminCase | null>(null);
  const [confirmAction, setConfirmAction] =
    React.useState<SokoProtectionAdminAction | null>(null);
  const [note, setNote] = React.useState("");
  const [resolutionCode, setResolutionCode] =
    React.useState<SokoProtectionResolutionCode>("recommend_no_action");
  const loadSeq = React.useRef(0);
  const actionLock = React.useRef(false);

  const load = React.useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!allowed || !caseId) {
        setLoading(false);
        return;
      }
      const seq = ++loadSeq.current;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError("");
      setUnauthorized(false);
      setOffline(false);
      try {
        const detail = await getAdminProtectionCase(caseId);
        if (seq !== loadSeq.current) return;
        setRow(detail);
      } catch (nextError: any) {
        if (seq !== loadSeq.current) return;
        const status = Number(nextError?.status || 0);
        const message = String(
          nextError?.message || "Could not load protection case."
        );
        if (status === 401 || status === 403) {
          setUnauthorized(true);
          setError(
            status === 401
              ? "Session expired. Sign in again as System Admin."
              : "Forbidden. System_Admin platform role required."
          );
        } else if (/reach|network|offline/i.test(message)) {
          setOffline(true);
          setError(message);
        } else {
          setError(message);
        }
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [allowed, caseId]
  );

  React.useEffect(() => {
    void load("initial");
  }, [load]);

  const openConfirm = (action: SokoProtectionAdminAction) => {
    if (actionPending || actionLock.current) return;
    setConfirmAction(action);
    setNote("");
    setResolutionCode("recommend_no_action");
    setError("");
  };

  const submitAction = async () => {
    if (!confirmAction || !caseId) return;
    if (actionLock.current || actionPending) return;
    let trimmed = "";
    try {
      trimmed = requireAdminActionNote(note);
    } catch (noteError) {
      setError(
        String(
          (noteError as Error)?.message ||
            "An admin note is required before confirming."
        )
      );
      return;
    }
    if (!getSessionSync()?.sessionToken) {
      setUnauthorized(true);
      setError("Session expired. Sign in again as System Admin.");
      return;
    }

    actionLock.current = true;
    setActionPending(true);
    setError("");
    try {
      await postAdminProtectionAction({
        caseId,
        action: confirmAction,
        note: trimmed,
        resolutionCode:
          confirmAction === "recommend_resolution" ? resolutionCode : undefined,
        resolutionSummary:
          confirmAction === "recommend_resolution" ? trimmed : undefined,
      });
      setConfirmAction(null);
      setNote("");
      await load("refresh");
    } catch (nextError: any) {
      const status = Number(nextError?.status || 0);
      const message = String(
        nextError?.message || "Could not apply admin action."
      );
      if (status === 401 || status === 403) {
        setUnauthorized(true);
      }
      if (nextError instanceof SokoProtectionAdminApiError) {
        setError(message);
      } else {
        setError(message);
      }
    } finally {
      actionLock.current = false;
      setActionPending(false);
    }
  };

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={42} color={PINK} />
        <Text style={styles.emptyTitle}>System Admin only</Text>
        <Text style={styles.emptyText}>
          Protection case review requires the verified System_Admin platform
          role.
        </Text>
      </View>
    );
  }

  const events = sortProtectionEventsChronologically(row?.events || []);
  const evidence = (row?.evidence || []).filter((item) =>
    evidenceBelongsToCase(item, row?.id || caseId)
  );
  const sellerResponse = sellerResponseFromEvents(events);
  const actions = adminActionsForState(row?.state || "");

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#251743", "#10131D", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={25} color={TEXT} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Protection case
          </Text>
          <Text style={styles.headerSub}>
            {caseId ? `Case ${caseId.slice(-10)}` : "Missing case id"}
          </Text>
        </View>
        <Pressable
          onPress={() => void load("refresh")}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Refresh case"
          disabled={actionPending}
        >
          {refreshing ? (
            <ActivityIndicator color={GOLD} />
          ) : (
            <Ionicons name="refresh" size={22} color={GOLD} />
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 40,
          gap: 12,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.disclaimer}>
          {SOKO_PROTECTION_ADMIN_HONEST_DISCLAIMER}
        </Text>

        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={GOLD} />
            <Text style={styles.stateText}>Loading case…</Text>
          </View>
        ) : null}

        {!loading && error && !row ? (
          <View style={styles.stateBox}>
            <Ionicons
              name={
                unauthorized
                  ? "lock-closed-outline"
                  : offline
                    ? "cloud-offline-outline"
                    : "alert-circle-outline"
              }
              size={28}
              color={PINK}
            />
            <Text style={styles.emptyTitle}>
              {unauthorized ? "Unauthorized" : offline ? "Offline" : "Error"}
            </Text>
            <Text style={styles.emptyText}>{error}</Text>
            <Pressable
              onPress={() => void load("initial")}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry loading case"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {row ? (
          <>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>CURRENT STATE</Text>
              <Text style={styles.title}>
                {protectionCaseStateLabel(row.state)}
              </Text>
              <Text style={styles.meta}>
                {protectionRequestTypeLabel(row.requestType)} ·{" "}
                {row.reasonCode || "—"}
              </Text>
              <Text style={styles.meta}>Order {row.orderId}</Text>
              <Text style={styles.meta}>
                {paymentVerificationKindLabel(row.paymentVerificationKind)}
                {row.paymentClaim
                  ? ` · ${paymentClaimLabelText(row.paymentClaim)}`
                  : ""}
              </Text>
              <Text style={styles.meta}>{deadlineStatusLabel(row)}</Text>
              <Text style={styles.meta}>
                Buyer {shortUserRef(row.buyerUserId)} · Seller{" "}
                {shortUserRef(row.sellerUserId)}
              </Text>
              <Text style={styles.meta}>
                Created {formatWhen(row.createdAt)} · Updated{" "}
                {formatWhen(row.updatedAt)}
              </Text>
              {row.summary ? (
                <Text style={styles.body}>{row.summary}</Text>
              ) : null}
            </View>

            <View style={styles.card} accessibilityLabel={ORDER_AT_CASE_OPENING_LABEL}>
              <Text style={styles.sectionTitle}>{ORDER_AT_CASE_OPENING_LABEL}</Text>
              <Text style={styles.body}>
                {orderAtCaseOpeningDisplay(row.immutableOrderSnapshot)}
              </Text>
              <Text style={styles.meta}>
                Taken from the immutable snapshot. This does not change when the
                live order status changes.
              </Text>
            </View>

            <View style={styles.card} accessibilityLabel={CURRENT_ORDER_STATUS_LABEL}>
              <Text style={styles.sectionTitle}>{CURRENT_ORDER_STATUS_LABEL}</Text>
              <Text style={styles.body}>
                {currentOrderStatusDisplay(row.liveOrderStatus)}
              </Text>
              <Text style={styles.meta}>
                Live fulfillment status from the server. Not copied from the
                frozen snapshot.
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Frozen product snapshot</Text>
              <Text style={styles.title}>
                {frozenProductTitle(row.immutableOrderSnapshot)}
              </Text>
              <Text style={styles.meta} selectable>
                Snapshot hash {row.immutableSnapshotHash || "—"}
              </Text>
              <Text style={styles.meta}>
                Read-only. This screen cannot edit the frozen snapshot, order
                fulfillment, or payment records.
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Buyer request</Text>
              <Text style={styles.body}>
                {row.description || "No description provided."}
              </Text>
              <Text style={styles.meta}>Reason {row.reasonCode || "—"}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Seller response</Text>
              {sellerResponse ? (
                <>
                  <Text style={styles.body}>
                    {sellerResponse.kind || "Response recorded"}
                  </Text>
                  {sellerResponse.note ? (
                    <Text style={styles.body}>{sellerResponse.note}</Text>
                  ) : (
                    <Text style={styles.meta}>No seller note.</Text>
                  )}
                  <Text style={styles.meta}>
                    {formatWhen(sellerResponse.at)}
                  </Text>
                </>
              ) : (
                <Text style={styles.meta}>No seller response yet.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Trusted evidence</Text>
              {evidence.length === 0 ? (
                <Text style={styles.meta}>No evidence attached yet.</Text>
              ) : (
                evidence.map((item) => (
                  <View key={item.id} style={styles.evidenceRow}>
                    <Text style={styles.body}>{item.evidenceType}</Text>
                    <Text style={styles.meta}>
                      Ref {item.trustedReferenceType || "none"}
                      {item.trustedReferenceId
                        ? ` · ${item.trustedReferenceId}`
                        : ""}
                    </Text>
                    {item.caption ? (
                      <Text style={styles.meta}>{item.caption}</Text>
                    ) : null}
                    <Text style={styles.meta}>{formatWhen(item.createdAt)}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Timeline</Text>
              {events.length === 0 ? (
                <Text style={styles.meta}>No events yet.</Text>
              ) : (
                events.map((event) => (
                  <View key={event.id} style={styles.timelineRow}>
                    <Text style={styles.body}>
                      {protectionEventLabel(event.eventType)}
                    </Text>
                    <Text style={styles.meta}>
                      {formatWhen(event.createdAt)} · {event.actorRole}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {row.resolutionCode || row.resolutionSummary ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Recommended resolution</Text>
                <Text style={styles.body}>
                  {resolutionCodeLabel(row.resolutionCode || "")}
                </Text>
                {row.resolutionSummary ? (
                  <Text style={styles.meta}>{row.resolutionSummary}</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Admin actions</Text>
              <Text style={styles.meta}>
                Consequential actions require confirmation and an admin note.
                Server transition rules still decide whether the action applies.
              </Text>
              {actions.length === 0 ? (
                <Text style={styles.meta}>
                  No admin actions are available in this state.
                </Text>
              ) : (
                actions.map((action) => (
                  <Pressable
                    key={action}
                    onPress={() => openConfirm(action)}
                    disabled={actionPending}
                    style={[
                      styles.actionBtn,
                      actionPending && styles.disabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={adminActionLabel(action)}
                    accessibilityState={{ disabled: actionPending }}
                  >
                    <Text style={styles.actionText}>
                      {adminActionLabel(action)}
                    </Text>
                  </Pressable>
                ))
              )}
              {error && row ? (
                <Text style={styles.errorInline}>{error}</Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={Boolean(confirmAction)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!actionPending) setConfirmAction(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}
            accessibilityViewIsModal
          >
            <Text style={styles.sectionTitle}>Confirm admin action</Text>
            <Text style={styles.body}>
              {confirmAction ? adminActionLabel(confirmAction) : ""}
            </Text>
            <Text style={styles.meta}>
              This does not move funds, edit fulfillment, or rewrite evidence
              history.
            </Text>

            {confirmAction === "recommend_resolution" ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={styles.meta}>Resolution code</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {SOKO_PROTECTION_ADMIN_RESOLUTION_CODES.map((code) => {
                    const active = resolutionCode === code;
                    return (
                      <Pressable
                        key={code}
                        onPress={() => setResolutionCode(code)}
                        style={[styles.chip, active && styles.chipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={resolutionCodeLabel(code)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                          ]}
                        >
                          {resolutionCodeLabel(code)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <Text style={styles.meta} accessibilityRole="text">
              An admin note is required. Confirm stays disabled until the note
              has text other than spaces.
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Admin note (required)"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              multiline
              maxLength={2000}
              editable={!actionPending}
              accessibilityLabel="Admin note"
              accessibilityHint="Required before confirming this action"
            />

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setConfirmAction(null)}
                disabled={actionPending}
                style={styles.secondaryBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel action"
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitAction()}
                disabled={actionPending || !canConfirmAdminNote(note)}
                style={[
                  styles.primaryBtn,
                  (actionPending || !canConfirmAdminNote(note)) && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Confirm admin action"
                accessibilityState={{
                  disabled: actionPending || !canConfirmAdminNote(note),
                }}
              >
                {actionPending ? (
                  <ActivityIndicator color="#1A1230" />
                ) : (
                  <Text style={styles.primaryText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 10,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  headerTitle: { color: TEXT, fontSize: 22, fontWeight: "800" },
  headerSub: { color: MUTED, fontSize: 13, marginTop: 2 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
  },
  disclaimer: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    gap: 8,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "800",
  },
  title: { color: TEXT, fontSize: 18, fontWeight: "800" },
  body: { color: TEXT, fontSize: 14, lineHeight: 20 },
  meta: { color: MUTED, fontSize: 12, lineHeight: 17 },
  evidenceRow: {
    gap: 4,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  timelineRow: {
    gap: 2,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  actionBtn: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(93,235,165,0.16)",
    borderWidth: 1,
    borderColor: "rgba(93,235,165,0.35)",
    paddingHorizontal: 14,
  },
  actionText: { color: GREEN, fontWeight: "800", fontSize: 14 },
  disabled: { opacity: 0.5 },
  errorInline: { color: PINK, fontSize: 13, lineHeight: 18 },
  stateBox: { alignItems: "center", gap: 10, padding: 18, marginTop: 24 },
  stateText: { color: MUTED },
  emptyTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  retryBtn: {
    minHeight: 44,
    minWidth: 120,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.18)",
    paddingHorizontal: 18,
  },
  retryText: { color: GOLD, fontWeight: "800" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#141826",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  input: {
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    color: TEXT,
    padding: 12,
    textAlignVertical: "top",
    fontSize: 15,
  },
  modalActions: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  secondaryText: { color: TEXT, fontWeight: "800" },
  primaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  primaryText: { color: "#1A1230", fontWeight: "900" },
  chip: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "rgba(244,208,111,0.18)",
    borderColor: "rgba(244,208,111,0.55)",
  },
  chipText: { color: MUTED, fontWeight: "700", fontSize: 12 },
  chipTextActive: { color: GOLD },
});
