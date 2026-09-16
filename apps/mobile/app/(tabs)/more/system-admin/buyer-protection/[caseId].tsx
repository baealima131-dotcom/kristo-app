import React from "react";
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  getAdminProtectionCase,
  postAdminProtectionAction,
  type SokoProtectionAdminCase,
  type SokoProtectionAdminEvent,
} from "@/src/lib/sokoProtectionAdminApi";
import {
  adminActionLabel,
  adminActionsForState,
  canConfirmAdminNote,
  conciseOrderStatusPair,
  currentOrderStatusDisplay,
  deadlineStatusLabel,
  deliveryMethodLabel,
  evidenceBelongsToCase,
  evidenceOwnerSide,
  evidenceSourceLabel,
  frozenMoney,
  frozenProductImageUrl,
  frozenProductTitle,
  frozenQuantity,
  humanOrderStatusLabel,
  orderAtCaseOpeningDisplay,
  partyPrimaryLabel,
  paymentMethodLabel,
  paymentStatusChip,
  protectionCaseStateLabel,
  protectionEventLabel,
  protectionRequestTypeLabel,
  requireAdminActionNote,
  resolutionCodeLabel,
  shortCaseRef,
  shortKristoId,
  sortProtectionEventsChronologically,
  SOKO_PROTECTION_ADMIN_RESOLUTION_CODES,
  trustedParty,
  type AdminPartyView,
  type SokoProtectionAdminAction,
  type SokoProtectionResolutionCode,
} from "@/src/lib/sokoProtectionAdminLabels";

const BG = "#070A12";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.58)";
const GOLD = "#F4D06F";
const PURPLE = "#C4B5FD";
const PINK = "#FF8AA4";
/** Matches homeFeedPremium.tabBarSolid.height. The bar is absolute, so sticky UI must clear it plus the safe area. */
const TAB_BAR_HEIGHT = 70;
const STICKY_BUTTON_BLOCK = 52;

type TabKey = "summary" | "evidence" | "history";

function shortActionCopy(action: SokoProtectionAdminAction) {
  if (action === "request_evidence") {
    return "Ask either party for supporting information.";
  }
  if (action === "recommend_resolution") {
    return "Record the recommended outcome. No money moves automatically.";
  }
  if (action === "close_case") {
    return "Close this review without changing payment or fulfillment.";
  }
  return adminActionLabel(action);
}

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

function initialsFor(label: string, party: AdminPartyView) {
  const name = String(party.displayName || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
  return letters || label.slice(0, 1).toUpperCase();
}

function headerStateLabel(state: string) {
  if (state === "evidence_review") return "Under review";
  return protectionCaseStateLabel(state);
}

function shortPartyRef(party: AdminPartyView) {
  if (party.kristoId) return shortKristoId(party.kristoId);
  const compact = String(party.userId || "").replace(/[^a-zA-Z0-9]/g, "");
  return compact ? compact.slice(-4).toUpperCase() : "";
}

export default function BuyerProtectionAdminCaseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ caseId?: string }>();
  const caseId = String(params.caseId || "").trim();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");
  const resolutionOffset = TAB_BAR_HEIGHT + insets.bottom;

  const [tab, setTab] = React.useState<TabKey>("summary");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [actionPending, setActionPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [row, setRow] = React.useState<SokoProtectionAdminCase | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] =
    React.useState<SokoProtectionAdminAction | null>(null);
  const [note, setNote] = React.useState("");
  const [resolutionCode, setResolutionCode] =
    React.useState<SokoProtectionResolutionCode>("recommend_no_action");
  const [technicalOpen, setTechnicalOpen] = React.useState(false);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [profile, setProfile] = React.useState<AdminPartyView | null>(null);
  const [observeTip, setObserveTip] = React.useState(false);
  const [contentHeight, setContentHeight] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [fullText, setFullText] = React.useState<{
    title: string;
    body: string;
  } | null>(null);
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
      try {
        const detail = await getAdminProtectionCase(caseId);
        if (seq !== loadSeq.current) return;
        setRow(detail);
        setImageFailed(false);
      } catch (nextError: any) {
        if (seq !== loadSeq.current) return;
        const status = Number(nextError?.status || 0);
        setError(
          status === 401
            ? "Session expired. Sign in again as System Admin."
            : status === 403
              ? "Forbidden. System_Admin platform role required."
              : String(nextError?.message || "Could not load protection case.")
        );
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
    if (actionLock.current || actionPending) return;
    setConfirmAction(action);
    setNote("");
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
      setSheetOpen(false);
      setConfirmAction(null);
      setNote("");
      await load("refresh");
    } catch (nextError: any) {
      setError(String(nextError?.message || "Could not apply admin action."));
    } finally {
      actionLock.current = false;
      setActionPending(false);
    }
  };

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={36} color={PINK} />
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
  const opening = row
    ? humanOrderStatusLabel(orderAtCaseOpeningDisplay(row.immutableOrderSnapshot))
    : "";
  const live = row
    ? humanOrderStatusLabel(currentOrderStatusDisplay(row.liveOrderStatus))
    : "";
  const statusPair = conciseOrderStatusPair(opening, live);
  const image = row ? frozenProductImageUrl(row.immutableOrderSnapshot) : null;
  const money = frozenMoney(row?.immutableOrderSnapshot);
  const quantity = frozenQuantity(row?.immutableOrderSnapshot);
  const buyer = row
    ? trustedParty({
        side: "buyer",
        buyerUserId: row.buyerUserId,
        sellerUserId: row.sellerUserId,
        parties: row.parties,
      })
    : null;
  const seller = row
    ? trustedParty({
        side: "seller",
        buyerUserId: row.buyerUserId,
        sellerUserId: row.sellerUserId,
        parties: row.parties,
      })
    : null;
  const method = paymentMethodLabel(
    String((row?.immutableOrderSnapshot as { paymentMethod?: string })?.paymentMethod || "")
  );
  const deadline = deadlineStatusLabel({
    state: row?.state || "",
    sellerResponseDeadline: row?.sellerResponseDeadline,
    evidenceDeadline: row?.evidenceDeadline,
    externalRefundDeadline: row?.externalRefundDeadline,
  });
  const priceLine = [
    money ? `${money.amount}${money.currency ? ` ${money.currency}` : ""}` : "Price unavailable",
    quantity ? `Qty ${quantity}` : "",
    row ? `Order ${shortCaseRef(row.orderId)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const orderStatusValue = statusPair.same
    ? statusPair.label
    : [statusPair.opening, statusPair.current].filter(Boolean).join(" → ") || "—";
  const productTitle = row ? frozenProductTitle(row.immutableOrderSnapshot) : "";
  const contentBottomPad = resolutionOffset + STICKY_BUTTON_BLOCK + 8;
  const contentWithoutPad = Math.max(0, contentHeight - contentBottomPad);
  const leftover =
    viewportHeight - contentWithoutPad - STICKY_BUTTON_BLOCK - resolutionOffset;
  const shortContentGap = leftover > 96 ? 36 : 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 2 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </Pressable>
        <View style={styles.headerCopy} accessibilityRole="header">
          <Text style={styles.kicker}>Protection case</Text>
          <Text style={styles.topTitle} numberOfLines={1}>
            {shortCaseRef(caseId)}
          </Text>
        </View>
        {row ? (
          <View style={styles.statePill}>
            <Text style={styles.statePillText}>{headerStateLabel(row.state)}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => setObserveTip((open) => !open)}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Evidence review only. Funds are handled outside SOKO."
        >
          <Ionicons name="information-circle-outline" size={20} color={MUTED} />
        </Pressable>
      </View>
      {observeTip ? (
        <Text style={styles.observeCaption}>
          Evidence review only. Funds are handled outside SOKO.
        </Text>
      ) : null}

      <ScrollView
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: contentBottomPad,
          gap: 8,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={GOLD}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.warn}>{error}</Text> : null}
        {row ? (
          <>
            <View style={styles.hero}>
              <ProductThumb
                uri={image}
                failed={imageFailed}
                onError={() => setImageFailed(true)}
              />
              <View style={styles.heroCopy}>
                <Text
                  style={[styles.title, productTitle.length > 28 && styles.titleLong]}
                  numberOfLines={2}
                >
                  {productTitle}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {priceLine}
                </Text>
                <View style={styles.chipRow}>
                  <View style={styles.miniChip}>
                    <Text style={styles.miniChipText} numberOfLines={1}>
                      {protectionRequestTypeLabel(row.requestType)}
                    </Text>
                  </View>
                  <View style={styles.miniChip}>
                    <Text style={styles.miniChipText} numberOfLines={1}>
                      {protectionCaseStateLabel(row.state)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.parties}>
              <PartyBit
                label="Buyer"
                accent="buyer"
                party={buyer}
                onPress={() => (buyer ? setProfile(buyer) : undefined)}
              />
              <Ionicons name="arrow-forward" size={12} color={MUTED} />
              <PartyBit
                label="Seller"
                accent="seller"
                party={seller}
                onPress={() => (seller ? setProfile(seller) : undefined)}
              />
            </View>

            <View style={styles.tabs}>
              {(["summary", "evidence", "history"] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={[styles.tab, tab === key && styles.tabOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab === key }}
                  accessibilityLabel={
                    key === "summary" ? "Summary" : key === "evidence" ? "Evidence" : "History"
                  }
                >
                  <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>
                    {key === "summary" ? "Summary" : key === "evidence" ? "Evidence" : "History"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === "summary" ? (
              <View style={styles.block}>
                <View style={styles.conversation}>
                  <ClampText
                    label="Buyer request"
                    text={row.description || "No description recorded."}
                    onViewFull={setFullText}
                  />
                  <View style={styles.conversationRule} />
                  <ClampText
                    label="Seller response"
                    text={
                      sellerResponse?.note ||
                      sellerResponse?.kind ||
                      "No seller response recorded."
                    }
                    onViewFull={setFullText}
                  />
                </View>
                <View style={styles.facts}>
                  <Fact label="Payment" value={paymentStatusChip(row.paymentVerificationKind)} />
                  <Fact label="Method" value={method} />
                  {statusPair.same ? (
                    <Fact label="Order status" value={statusPair.label} />
                  ) : (
                    <Fact label="Order status" value={orderStatusValue} />
                  )}
                  <Fact
                    label="Delivery"
                    value={deliveryMethodLabel(row.immutableOrderSnapshot)}
                  />
                  <Fact
                    label="Deadline"
                    value={deadline === "No active deadline" ? "None" : deadline}
                  />
                </View>
              </View>
            ) : null}

            {tab === "evidence" ? (
              <View style={styles.block}>
                <Text style={styles.meta}>{evidence.length} attached</Text>
                {evidence.length === 0 ? (
                  <View>
                    <Text style={styles.emptyTitle}>No evidence attached</Text>
                    <Text style={styles.emptyText}>
                      You can request supporting evidence from the buyer or seller.
                    </Text>
                  </View>
                ) : (
                  evidence.map((item) => (
                    <View key={item.id} style={styles.rowItem}>
                      <Text style={styles.body} numberOfLines={1}>
                        {item.caption || "No caption"}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {evidenceOwnerSide({
                          submittedByUserId: item.submittedByUserId,
                          buyerUserId: row.buyerUserId,
                          sellerUserId: row.sellerUserId,
                        })}{" "}
                        · {evidenceSourceLabel(item.trustedReferenceType)} ·{" "}
                        {formatWhen(item.createdAt)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {tab === "history" ? (
              <View style={styles.block}>
                {events.map((event) => (
                  <View key={event.id} style={styles.historyRow}>
                    <View style={styles.dot} />
                    <Text style={styles.body} numberOfLines={1}>
                      {protectionEventLabel(event.eventType)}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {formatWhen(event.createdAt)}
                    </Text>
                  </View>
                ))}
                <Pressable
                  onPress={() => setTechnicalOpen((open) => !open)}
                  style={styles.techLink}
                  accessibilityRole="button"
                  accessibilityLabel="Technical details"
                >
                  <Text style={styles.techLinkText}>
                    {technicalOpen ? "Hide technical details" : "Technical details"}
                  </Text>
                </Pressable>
                {technicalOpen ? (
                  <View style={styles.techBody}>
                    <Text selectable style={styles.techText}>
                      Frozen product snapshot. Admins cannot edit the frozen snapshot.
                    </Text>
                    <Text selectable style={styles.techText}>
                      {row.immutableSnapshotHash}
                    </Text>
                    <Text selectable style={styles.techText}>
                      {row.id}
                    </Text>
                    <Text selectable style={styles.techText}>
                      {row.orderId}
                    </Text>
                    <Text selectable style={styles.techText}>
                      {row.buyerUserId}
                    </Text>
                    <Text selectable style={styles.techText}>
                      {row.sellerUserId}
                    </Text>
                    {events.map((event) => (
                      <Text key={`raw-${event.id}`} selectable style={styles.techText}>
                        {event.eventType} {event.createdAt}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : loading ? (
          <Text style={styles.meta}>Loading case</Text>
        ) : null}
      </ScrollView>

      <View style={[styles.sticky, { bottom: resolutionOffset + shortContentGap }]}>
        <Pressable
          onPress={() => {
            setConfirmAction(null);
            setSheetOpen(true);
          }}
          style={styles.stickyButton}
          accessibilityRole="button"
          accessibilityLabel="Review resolution"
        >
          <Text style={styles.stickyText}>Review resolution</Text>
        </Pressable>
      </View>

      <Modal visible={sheetOpen} transparent animationType="slide">
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>Resolution Center</Text>
            {!confirmAction
              ? actions.map((action) => (
                  <Pressable
                    key={action}
                    onPress={() => openConfirm(action)}
                    style={styles.actionRow}
                    accessibilityRole="button"
                    accessibilityLabel={adminActionLabel(action)}
                  >
                    <Ionicons
                      name={
                        action === "close_case"
                          ? "close-circle-outline"
                          : action === "recommend_resolution"
                            ? "checkmark-circle-outline"
                            : "add-circle-outline"
                      }
                      size={22}
                      color={
                        action === "close_case"
                          ? PINK
                          : action === "recommend_resolution"
                            ? GOLD
                            : PURPLE
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.body}>{adminActionLabel(action)}</Text>
                      <Text style={styles.meta}>{shortActionCopy(action)}</Text>
                    </View>
                  </Pressable>
                ))
              : (
                <View style={{ gap: 8 }}>
                  <Text style={styles.body}>{adminActionLabel(confirmAction)}</Text>
                  {confirmAction === "recommend_resolution" ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {SOKO_PROTECTION_ADMIN_RESOLUTION_CODES.map((code) => (
                        <Pressable
                          key={code}
                          onPress={() => setResolutionCode(code)}
                          style={[styles.code, resolutionCode === code && styles.codeOn]}
                          accessibilityRole="button"
                          accessibilityLabel={resolutionCodeLabel(code)}
                        >
                          <Text style={styles.meta}>{resolutionCodeLabel(code)}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Admin note"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    style={styles.note}
                    multiline
                    accessibilityLabel="Admin note"
                  />
                  <Text style={styles.meta}>An admin note is required</Text>
                  <Text style={styles.warn}>
                    This records an admin decision. It does not move funds or change fulfillment.
                  </Text>
                  {error ? <Text style={styles.warn}>{error}</Text> : null}
                  <Pressable
                    onPress={() => void submitAction()}
                    disabled={actionPending || !canConfirmAdminNote(note)}
                    style={styles.confirm}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm admin action"
                  >
                    <Text style={styles.confirmText}>
                      {actionPending ? "Saving" : "Confirm admin action"}
                    </Text>
                  </Pressable>
                </View>
              )}
            <Pressable
              onPress={() => {
                if (confirmAction) setConfirmAction(null);
                else setSheetOpen(false);
              }}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Close resolution center"
            >
              <Text style={styles.meta}>{confirmAction ? "Back" : "Close"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(profile)} transparent animationType="fade">
        <Pressable style={styles.backdrop} onPress={() => setProfile(null)}>
          <View style={styles.profileSheet}>
            <Text style={styles.body}>{profile ? partyPrimaryLabel(profile) : ""}</Text>
            {profile?.kristoId ? (
              <Text style={styles.meta}>{shortKristoId(profile.kristoId)}</Text>
            ) : null}
            {profile?.profileStatus ? (
              <Text style={styles.meta}>{profile.profileStatus}</Text>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(fullText)} transparent animationType="slide">
        <Pressable style={styles.backdrop} onPress={() => setFullText(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>{fullText?.title}</Text>
            <ScrollView style={styles.fullScroll}>
              <Text selectable style={styles.body}>
                {fullText?.body}
              </Text>
            </ScrollView>
            <Pressable
              onPress={() => setFullText(null)}
              accessibilityRole="button"
              accessibilityLabel="Close full text"
            >
              <Text style={styles.meta}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ProductThumb({
  uri,
  failed,
  onError,
}: {
  uri: string | null;
  failed: boolean;
  onError: () => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    setLoaded(false);
  }, [uri, failed]);
  const showImage = Boolean(uri) && !failed;
  return (
    <View
      style={styles.heroImageSlot}
      accessibilityLabel={showImage && loaded ? "Product image" : "Product image unavailable"}
    >
      <View style={styles.heroFallback}>
        <Ionicons name="cube-outline" size={26} color={GOLD} />
      </View>
      {showImage ? (
        <Image
          source={{ uri: uri || undefined }}
          resizeMode="cover"
          style={[styles.heroImage, { opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={() => {
            console.log("PROTECTION_IMAGE_ERROR", "frozen-snapshot");
            onError();
          }}
        />
      ) : null}
    </View>
  );
}

function PartyBit({
  label,
  accent,
  party,
  onPress,
}: {
  label: string;
  accent: "buyer" | "seller";
  party: AdminPartyView | null;
  onPress: () => void;
}) {
  const [avatarFailed, setAvatarFailed] = React.useState(false);
  if (!party) return null;
  const name = String(party.displayName || "").trim() || label;
  const shortId = shortPartyRef(party);
  const showAvatar = Boolean(party.avatarUrl) && !avatarFailed;
  return (
    <Pressable
      onPress={onPress}
      style={styles.partyBit}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${name}${shortId ? ` ${shortId}` : ""}`}
    >
      <View
        style={[
          styles.avatarFallback,
          accent === "seller" ? styles.sellerAvatar : styles.buyerAvatar,
        ]}
      >
        <Text
          style={[
            styles.initials,
            accent === "seller" ? styles.sellerInitials : styles.buyerInitials,
          ]}
        >
          {initialsFor(label, party)}
        </Text>
        {showAvatar ? (
          <Image
            source={{ uri: party.avatarUrl || undefined }}
            style={styles.avatar}
            onError={() => setAvatarFailed(true)}
          />
        ) : null}
      </View>
      <View style={styles.partyCopy}>
        <Text style={styles.partyName} numberOfLines={1}>
          {name}
        </Text>
        {shortId ? (
          <Text style={styles.partyId} numberOfLines={1}>
            {shortId}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ClampText({
  label,
  text,
  onViewFull,
}: {
  label: string;
  text: string;
  onViewFull: (value: { title: string; body: string }) => void;
}) {
  const [truncated, setTruncated] = React.useState(false);
  return (
    <View>
      <Text style={styles.meta}>{label}</Text>
      <View>
        <Text
          style={[styles.conversationText, styles.measure]}
          onTextLayout={(event) => {
            setTruncated((event.nativeEvent.lines || []).length > 3);
          }}
        >
          {text}
        </Text>
        <Text style={styles.conversationText} numberOfLines={3}>
          {text}
        </Text>
      </View>
      {truncated ? (
        <Pressable
          onPress={() => onViewFull({ title: label, body: text })}
          accessibilityRole="button"
          accessibilityLabel={`View full ${label}`}
        >
          <Text style={styles.viewFull}>View full</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>
        {value}
      </Text>
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
    padding: 24,
    gap: 8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    minHeight: 48,
  },
  headerCopy: { flex: 1, justifyContent: "center" },
  kicker: { color: MUTED, fontSize: 11, lineHeight: 13, fontWeight: "600" },
  topTitle: { color: TEXT, fontSize: 15, fontWeight: "800", lineHeight: 18 },
  iconButton: { minWidth: 40, minHeight: 40, justifyContent: "center" },
  statePill: {
    height: 24,
    paddingHorizontal: 8,
    marginRight: 2,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
  },
  statePillText: { color: GOLD, fontSize: 11, fontWeight: "700" },
  observeCaption: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  hero: {
    maxHeight: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 14,
    backgroundColor: "rgba(98,70,168,0.22)",
    overflow: "hidden",
  },
  heroImageSlot: {
    width: 92,
    height: 92,
    borderRadius: 12,
    overflow: "hidden",
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: 92,
    height: 92,
  },
  heroFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,14,24,0.92)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.7)",
    shadowColor: GOLD,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  heroCopy: { flex: 1, gap: 3, justifyContent: "center" },
  title: { color: TEXT, fontSize: 15, fontWeight: "800", lineHeight: 19 },
  titleLong: { fontSize: 13, lineHeight: 16, fontWeight: "700" },
  body: { color: TEXT, fontSize: 13, lineHeight: 18 },
  meta: { color: MUTED, fontSize: 12, lineHeight: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  miniChip: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  miniChipText: { color: TEXT, fontSize: 11, fontWeight: "700" },
  parties: {
    maxHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
  },
  partyBit: {
    flex: 1,
    maxHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  partyCopy: { flex: 1 },
  partyName: { color: TEXT, fontSize: 13, fontWeight: "700" },
  partyId: { color: MUTED, fontSize: 11 },
  avatar: {
    ...StyleSheet.absoluteFillObject,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
  },
  buyerAvatar: {
    backgroundColor: "rgba(167,139,250,0.22)",
    borderColor: PURPLE,
  },
  sellerAvatar: {
    backgroundColor: "rgba(80,190,170,0.18)",
    borderColor: "#7DDBC8",
  },
  initials: { fontSize: 12, fontWeight: "800" },
  buyerInitials: { color: PURPLE },
  sellerInitials: { color: "#7DDBC8" },
  conversationText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    lineHeight: 16,
  },
  tabs: {
    height: 42,
    maxHeight: 42,
    flexDirection: "row",
    padding: 3,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  tabOn: { backgroundColor: "rgba(167,139,250,0.28)" },
  tabText: { color: MUTED, fontWeight: "700", fontSize: 13 },
  tabTextOn: { color: TEXT },
  block: { gap: 8 },
  conversation: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    gap: 6,
  },
  conversationRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  measure: {
    position: "absolute",
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
  viewFull: { color: GOLD, fontSize: 12, fontWeight: "700", marginTop: 2 },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
  },
  fact: {
    width: "50%",
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
  },
  factValue: { color: TEXT, fontSize: 13, fontWeight: "700", lineHeight: 17 },
  techLink: { minHeight: 32, justifyContent: "center" },
  techLinkText: { color: MUTED, fontSize: 12, fontWeight: "600" },
  techBody: { gap: 4 },
  techText: { color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 15 },
  rowItem: { gap: 1, paddingVertical: 4 },
  historyRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PURPLE,
  },
  emptyTitle: { color: TEXT, fontSize: 15, fontWeight: "800" },
  emptyText: { color: MUTED, fontSize: 13, lineHeight: 18 },
  warn: { color: PINK, fontSize: 13, lineHeight: 18 },
  sticky: {
    position: "absolute",
    left: 12,
    right: 12,
    paddingTop: 4,
  },
  stickyButton: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,10,18,0.98)",
    borderWidth: 1.5,
    borderColor: GOLD,
  },
  stickyText: { color: GOLD, fontWeight: "800", fontSize: 15 },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    padding: 16,
    gap: 8,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "#14122A",
  },
  sheetTitle: { color: TEXT, fontSize: 18, fontWeight: "800" },
  actionRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  note: {
    minHeight: 72,
    color: TEXT,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  code: {
    minHeight: 44,
    paddingHorizontal: 10,
    marginRight: 6,
    borderRadius: 10,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  codeOn: { backgroundColor: "rgba(244,208,111,0.2)" },
  confirm: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  confirmText: { color: "#16120A", fontWeight: "800" },
  profileSheet: {
    margin: 24,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#14122A",
    gap: 4,
  },
  fullScroll: { maxHeight: 280 },
});
