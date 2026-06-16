import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import { assignScheduleSlotOnServer } from "@/src/lib/guestClaimSlotAssign";
import {
  getGuestSlotBadgeLabel,
  getGuestSlotUiState,
  isValidKristoAssignId,
  MIN_GUEST_SLOT_DURATION_MIN,
  normalizeGuestClaimSlot,
  slotHasClaimant,
} from "@/src/lib/guestClaimCenterUtils";

type GuestClaimCenterPanelProps = {
  canManage: boolean;
  slots: any[];
  guestClockNow: number;
  churchId: string;
  churchName: string;
  sessionUserId: string;
  apiHeaders: Record<string, string>;
  guestClaimTotalMinutes: number;
  guestClaimClaimedCount: number;
  guestClaimOpenCount: number;
  guestInvitationCount: number;
  guestClaimConflictCount: number;
  onBack: () => void;
  onClearSchedules: () => void;
  onMoveSlot: (slotId: string, direction: "up" | "down", sourceFeedId?: string) => void;
  onAdjustTime: (slotId: string, minutes: number, sourceFeedId?: string) => void;
  onApprove: (slotId: string, sourceFeedId?: string) => void;
  onReject: (slotId: string, sourceFeedId?: string) => void;
  onToggleLock: (slotId: string, locked: boolean, sourceFeedId?: string) => void;
  onFixConflict: (slotId: string, sourceFeedId?: string) => void;
  onAssignComplete: () => void;
  formatGuestSlotDate: (slot: any) => string;
  formatGuestSlotCountdown: (slot: any) => string;
  getGuestSlotTimeState: (slot: any) => string;
  getGuestSlotConflict: (slot: any, index: number, slots: any[]) => string | null;
};

type RemoteAction = {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone?: "default" | "approve" | "danger" | "profile" | "assign";
};

export function GuestClaimCenterPanel(props: GuestClaimCenterPanelProps) {
  const router = useRouter();
  const {
    canManage,
    slots,
    churchId,
    churchName,
    sessionUserId,
    apiHeaders,
    guestClaimTotalMinutes,
    guestClaimClaimedCount,
    guestClaimOpenCount,
    guestInvitationCount,
    guestClaimConflictCount,
    onBack,
    onClearSchedules,
    onMoveSlot,
    onAdjustTime,
    onApprove,
    onReject,
    onToggleLock,
    onFixConflict,
    onAssignComplete,
    formatGuestSlotDate,
    formatGuestSlotCountdown,
    getGuestSlotTimeState,
    getGuestSlotConflict,
  } = props;

  const normalizedSlots = useMemo(() => slots.map(normalizeGuestClaimSlot), [slots]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTab, setAssignTab] = useState<"members" | "kristo">("members");
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [kristoDraft, setKristoDraft] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");

  useEffect(() => {
    if (!selectedSlotId && normalizedSlots[0]?.id) {
      setSelectedSlotId(String(normalizedSlots[0].id));
    }
  }, [normalizedSlots, selectedSlotId]);

  const selectedSlot = useMemo(
    () => normalizedSlots.find((slot) => String(slot.id) === String(selectedSlotId)) || null,
    [normalizedSlots, selectedSlotId]
  );

  const selectedIndex = useMemo(
    () => normalizedSlots.findIndex((slot) => String(slot.id) === String(selectedSlotId)),
    [normalizedSlots, selectedSlotId]
  );

  const selectedState = selectedSlot ? getGuestSlotUiState(selectedSlot) : null;
  const selectedFeedId = String(selectedSlot?.sourceFeedId || "").trim();
  const selectedDuration = Math.max(
    MIN_GUEST_SLOT_DURATION_MIN,
    Number(selectedSlot?.durationMin || MIN_GUEST_SLOT_DURATION_MIN)
  );

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const rows = await fetchChurchMembers();
      setMembers(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      Alert.alert("Members", String(e?.message || "Could not load church members."));
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (assignOpen && assignTab === "members" && !members.length && !membersLoading) {
      void loadMembers();
    }
  }, [assignOpen, assignTab, members.length, membersLoading, loadMembers]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => {
      const name = String(member?.name || member?.displayName || "").toLowerCase();
      const code = String(member?.kristoId || member?.userCode || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [memberQuery, members]);

  const viewProfile = useCallback(() => {
    if (!selectedSlot) return;
    const userId = String(selectedSlot.claimedByUserId || "").trim();
    if (!userId) {
      Alert.alert("View profile", "Claimant profile is not synced yet. Try again shortly.");
      return;
    }
    router.push({
      pathname: "/(tabs)/church/member",
      params: {
        userId,
        churchId,
        churchName,
        name: String(selectedSlot.claimedByName || selectedSlot.claimedBy || "Member"),
        role: String(selectedSlot.claimedByRole || "Member"),
        status: "Active",
      },
    } as any);
  }, [churchId, churchName, router, selectedSlot]);

  const assignMember = useCallback(
    async (member: { userId?: string; kristoId?: string; name?: string; role?: string; avatarUri?: string }) => {
      if (!selectedSlot) return;
      if (!selectedFeedId) {
        Alert.alert("Assign member", "This slot is not linked to a published schedule yet.");
        return;
      }
      if (slotHasClaimant(selectedSlot)) {
        Alert.alert("Assign member", "This slot already has a claimant.");
        return;
      }
      const targetUserId = String(member.userId || "").trim();
      if (targetUserId && targetUserId === sessionUserId) {
        Alert.alert("Assign member", "Use Claim & Go Live on the Home Feed to claim your own slot.");
        return;
      }

      setAssignBusy(true);
      try {
        await assignScheduleSlotOnServer({
          postId: selectedFeedId,
          slotId: String(selectedSlot.id),
          userId: member.userId,
          kristoId: member.kristoId,
          name: member.name,
          role: member.role,
          avatarUri: member.avatarUri,
          headers: apiHeaders,
        });
        setAssignOpen(false);
        setKristoDraft("");
        onAssignComplete();
        Alert.alert("Assigned", `${member.name || "Member"} was assigned to this slot.`);
      } catch (e: any) {
        Alert.alert("Assign failed", String(e?.message || "Could not assign member."));
      } finally {
        setAssignBusy(false);
      }
    },
    [apiHeaders, onAssignComplete, selectedFeedId, selectedSlot, sessionUserId]
  );

  const assignByKristoId = useCallback(async () => {
    const code = String(kristoDraft || "").trim().toUpperCase();
    if (!isValidKristoAssignId(code)) {
      Alert.alert("Kristo ID", "Use a valid Kristo ID like KR7-25023WY.");
      return;
    }
    await assignMember({ kristoId: code });
  }, [assignMember, kristoDraft]);

  const remoteActions: RemoteAction[] = useMemo(() => {
    if (!canManage) return [];
    if (!selectedSlot) {
      return [
        {
          key: "hint",
          label: "Select a slot first",
          onPress: () => {},
          disabled: true,
          disabledReason: "Tap a slot card above",
        },
      ];
    }

    const canMoveUp = selectedIndex > 0;
    const canMoveDown = selectedIndex >= 0 && selectedIndex < normalizedSlots.length - 1;
    const canSubtract = selectedDuration > MIN_GUEST_SLOT_DURATION_MIN;
    const hasClaim = slotHasClaimant(selectedSlot);
    const isClaimed = selectedState === "claimed";
    const isApproved = selectedState === "approved";
    const isOpen = selectedState === "open";
    const isLocked = selectedState === "locked";

    return [
      {
        key: "up",
        label: "Move Up",
        onPress: () => onMoveSlot(String(selectedSlot.id), "up", selectedFeedId),
        disabled: !canMoveUp,
        disabledReason: "Already first",
      },
      {
        key: "down",
        label: "Move Down",
        onPress: () => onMoveSlot(String(selectedSlot.id), "down", selectedFeedId),
        disabled: !canMoveDown,
        disabledReason: "Already last",
      },
      {
        key: "plus",
        label: "+5 min",
        onPress: () => onAdjustTime(String(selectedSlot.id), 5, selectedFeedId),
      },
      {
        key: "minus",
        label: "-5 min",
        onPress: () => onAdjustTime(String(selectedSlot.id), -5, selectedFeedId),
        disabled: !canSubtract,
        disabledReason: `Minimum ${MIN_GUEST_SLOT_DURATION_MIN} min`,
      },
      hasClaim
        ? {
            key: "profile",
            label: "View Profile",
            onPress: viewProfile,
            disabled: !String(selectedSlot.claimedByUserId || "").trim(),
            disabledReason: "Profile not synced",
            tone: "profile",
          }
        : {
            key: "assign",
            label: "Assign Member",
            onPress: () => setAssignOpen(true),
            disabled: isLocked || !selectedFeedId,
            disabledReason: isLocked ? "Slot is locked" : "No schedule link",
            tone: "assign",
          },
      {
        key: "approve",
        label: isApproved ? "Approved ✓" : "Approve",
        onPress: () => onApprove(String(selectedSlot.id), selectedFeedId),
        disabled: !isClaimed,
        disabledReason: "Needs claimed guest",
        tone: "approve",
      },
      {
        key: "lock",
        label: selectedSlot.locked ? "Unlock Slot" : "Lock Slot",
        onPress: () => onToggleLock(String(selectedSlot.id), !selectedSlot.locked, selectedFeedId),
        disabled: hasClaim && !isApproved,
        disabledReason: "Approve or reject first",
      },
      {
        key: "reject",
        label: isApproved ? "Remove Guest" : isClaimed ? "Reject" : "Remove",
        onPress: () => onReject(String(selectedSlot.id), selectedFeedId),
        disabled: isOpen || isLocked,
        disabledReason: "No guest to remove",
        tone: "danger",
      },
    ];
  }, [
    canManage,
    normalizedSlots.length,
    onAdjustTime,
    onApprove,
    onMoveSlot,
    onReject,
    onToggleLock,
    selectedDuration,
    selectedFeedId,
    selectedIndex,
    selectedSlot,
    selectedState,
    viewProfile,
  ]);

  const remoteHint = useMemo(() => {
    const disabled = remoteActions.find((action) => action.disabled && action.disabledReason);
    if (!selectedSlot) return "Tap a slot card, then use the remote controls.";
    return disabled?.disabledReason || "Controls apply to the selected slot.";
  }, [remoteActions, selectedSlot]);

  return (
    <>
      <View style={styles.hero}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#F4C95D" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroKicker}>Guests claim center</Text>
          <Text style={styles.heroTitle}>Guests</Text>
          <Text style={styles.heroText}>
            Select a slot, then use the remote to reorder, adjust time, approve, assign, or lock.
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.summaryScroll}
        contentContainerStyle={styles.summaryRow}
      >
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{guestClaimTotalMinutes}</Text>
          <Text style={styles.summaryLabel}>Min</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{guestClaimClaimedCount}</Text>
          <Text style={styles.summaryLabel}>Claimed</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{guestClaimOpenCount}</Text>
          <Text style={styles.summaryLabel}>Open</Text>
        </View>
        <View style={[styles.summaryPill, styles.summaryInvitePill]}>
          <Text style={styles.summaryValue}>{guestInvitationCount}</Text>
          <Text style={styles.summaryLabel}>Invites</Text>
        </View>
        <Pressable onPress={onClearSchedules} style={[styles.summaryPill, styles.summaryDangerPill]}>
          <Text style={[styles.summaryValue, { color: "#FCA5A5" }]}>DEL</Text>
          <Text style={styles.summaryLabel}>Old</Text>
        </Pressable>
      </ScrollView>

      {guestClaimConflictCount > 0 ? (
        <View style={styles.conflictBanner}>
          <Ionicons name="warning-outline" size={18} color="#FCA5A5" />
          <Text style={styles.conflictBannerText}>
            {guestClaimConflictCount} time conflict{guestClaimConflictCount > 1 ? "s" : ""} detected
          </Text>
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {!normalizedSlots.length ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={28} color="rgba(255,255,255,0.35)" />
            <Text style={styles.emptyTitle}>No guest claims yet</Text>
            <Text style={styles.emptyText}>
              Create a schedule first. When people claim your Home Feed time cards, they will appear here.
            </Text>
          </View>
        ) : (
          normalizedSlots.map((slot, index) => {
            const selected = String(slot.id) === String(selectedSlotId);
            const conflict = getGuestSlotConflict(slot, index, normalizedSlots);
            const state = getGuestSlotUiState(slot);

            return (
              <Pressable
                key={String(slot.id || index)}
                onPress={() => setSelectedSlotId(String(slot.id))}
                style={[styles.card, selected ? styles.cardSelected : null]}
              >
                <View style={styles.cardTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{formatGuestSlotDate(slot)}</Text>
                    <Text style={styles.cardTitle}>{slot.title}</Text>
                  </View>
                  <View style={[styles.statusPill, selected ? styles.statusPillSelected : null]}>
                    <Text style={styles.statusText}>{getGuestSlotBadgeLabel(slot)}</Text>
                  </View>
                </View>

                <View style={styles.personRow}>
                  {slot.avatarUri ? (
                    <Image source={{ uri: slot.avatarUri }} style={styles.avatar} resizeMode="cover" />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>
                        {String(slot.claimedBy || "O").slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personKicker}>
                      {state === "open" ? "No claimant yet" : state === "approved" ? "Approved guest" : "Claimed by"}
                    </Text>
                    <Text style={styles.personName} numberOfLines={1}>
                      {slot.claimedBy}
                    </Text>
                  </View>
                  {selected ? (
                    <View style={styles.selectedBadge}>
                      <Ionicons name="radio-button-on" size={16} color="#F4C95D" />
                      <Text style={styles.selectedBadgeText}>Selected</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name="time-outline" size={14} color="#F4C95D" />
                  <Text style={styles.infoText}>
                    {slot.durationMin} min • {slot.startTime || "Start"} - {slot.endTime || "End"}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name={getGuestSlotTimeState(slot) === "live" ? "radio-outline" : "hourglass-outline"} size={14} color="#F4C95D" />
                  <Text style={styles.infoText}>{formatGuestSlotCountdown(slot)}</Text>
                </View>

                {conflict ? (
                  <View style={styles.conflictRow}>
                    <Ionicons name="alert-circle-outline" size={16} color="#FCA5A5" />
                    <Text style={styles.conflictText}>TIME CONFLICT • {conflict}</Text>
                    <Pressable onPress={() => onFixConflict(String(slot.id), slot.sourceFeedId)} style={styles.fixBtn}>
                      <Text style={styles.fixBtnText}>FIX</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {canManage ? (
        <View style={styles.remoteDock}>
          <Text style={styles.remoteTitle}>Slot remote</Text>
          <Text style={styles.remoteHint}>{remoteHint}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.remoteRow}>
            {remoteActions.map((action) => (
              <Pressable
                key={action.key}
                disabled={action.disabled}
                onPress={action.onPress}
                style={[
                  styles.remoteBtn,
                  action.tone === "approve" ? styles.remoteBtnApprove : null,
                  action.tone === "danger" ? styles.remoteBtnDanger : null,
                  action.tone === "profile" ? styles.remoteBtnProfile : null,
                  action.tone === "assign" ? styles.remoteBtnAssign : null,
                  action.disabled ? styles.remoteBtnDisabled : null,
                ]}
              >
                <Text style={[styles.remoteBtnText, action.disabled ? styles.remoteBtnTextDisabled : null]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Modal visible={assignOpen} transparent animationType="slide" onRequestClose={() => setAssignOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign member</Text>
              <Pressable onPress={() => setAssignOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.modalTabs}>
              <Pressable
                onPress={() => setAssignTab("members")}
                style={[styles.modalTab, assignTab === "members" ? styles.modalTabActive : null]}
              >
                <Text style={[styles.modalTabText, assignTab === "members" ? styles.modalTabTextActive : null]}>
                  Church members
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAssignTab("kristo")}
                style={[styles.modalTab, assignTab === "kristo" ? styles.modalTabActive : null]}
              >
                <Text style={[styles.modalTabText, assignTab === "kristo" ? styles.modalTabTextActive : null]}>
                  Kristo ID
                </Text>
              </Pressable>
            </View>

            {assignTab === "members" ? (
              <>
                <TextInput
                  value={memberQuery}
                  onChangeText={setMemberQuery}
                  placeholder="Search members"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  style={styles.searchInput}
                />
                {membersLoading ? (
                  <ActivityIndicator color="#F4C95D" style={{ marginVertical: 18 }} />
                ) : (
                  <ScrollView style={styles.memberList} contentContainerStyle={{ gap: 8 }}>
                    {filteredMembers.map((member) => {
                      const name = String(member?.name || member?.displayName || "Member");
                      const userId = String(member?.userId || member?.id || "");
                      const avatar = String(member?.avatarUri || member?.avatarUrl || "");
                      return (
                        <Pressable
                          key={userId || name}
                          disabled={assignBusy}
                          onPress={() =>
                            void assignMember({
                              userId,
                              name,
                              role: String(member?.role || member?.roleLabel || "Member"),
                              avatarUri: avatar,
                            })
                          }
                          style={styles.memberRow}
                        >
                          {avatar ? (
                            <Image source={{ uri: avatar }} style={styles.memberAvatar} />
                          ) : (
                            <View style={styles.memberAvatarFallback}>
                              <Text style={styles.memberAvatarText}>{name.slice(0, 1).toUpperCase()}</Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.memberName}>{name}</Text>
                            <Text style={styles.memberMeta}>
                              {String(member?.kristoId || member?.userCode || member?.roleLabel || "Member")}
                            </Text>
                          </View>
                          <Ionicons name="person-add-outline" size={18} color="#F4C95D" />
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </>
            ) : (
              <>
                <Text style={styles.modalHelp}>Enter a Kristo ID starting with KR7-</Text>
                <TextInput
                  value={kristoDraft}
                  onChangeText={(text) => setKristoDraft(text.toUpperCase())}
                  placeholder="KR7-25023WY"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  autoCapitalize="characters"
                  style={styles.searchInput}
                />
                <Pressable
                  disabled={assignBusy}
                  onPress={() => void assignByKristoId()}
                  style={[styles.assignConfirmBtn, assignBusy ? styles.remoteBtnDisabled : null]}
                >
                  {assignBusy ? (
                    <ActivityIndicator color="#07111F" />
                  ) : (
                    <Text style={styles.assignConfirmText}>Assign by Kristo ID</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  heroKicker: { color: "#F4C95D", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 2 },
  heroText: { color: "rgba(255,255,255,0.62)", fontSize: 13, lineHeight: 18, marginTop: 4 },
  summaryScroll: { marginBottom: 10 },
  summaryRow: { gap: 8, paddingRight: 8 },
  summaryPill: {
    minWidth: 68,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  summaryInvitePill: { borderColor: "rgba(244,201,93,0.28)" },
  summaryDangerPill: { borderColor: "rgba(252,165,165,0.28)" },
  summaryValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  summaryLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "700", marginTop: 2 },
  conflictBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(252,165,165,0.08)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.22)",
    marginBottom: 10,
  },
  conflictBannerText: { color: "#FCA5A5", fontSize: 12, fontWeight: "700", flex: 1 },
  list: { flex: 1 },
  listContent: { gap: 12, paddingBottom: 160 },
  emptyCard: {
    padding: 24,
    borderRadius: 18,
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  emptyText: { color: "rgba(255,255,255,0.58)", textAlign: "center", lineHeight: 20 },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardSelected: {
    borderColor: "rgba(244,201,93,0.72)",
    backgroundColor: "rgba(244,201,93,0.08)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardLabel: { color: "rgba(255,255,255,0.52)", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  cardTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 2 },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusPillSelected: { borderColor: "rgba(244,201,93,0.45)" },
  statusText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.12)",
  },
  avatarFallbackText: { color: "#F4C95D", fontSize: 18, fontWeight: "900" },
  personKicker: { color: "rgba(255,255,255,0.52)", fontSize: 11, fontWeight: "700" },
  personName: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginTop: 2 },
  selectedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  selectedBadgeText: { color: "#F4C95D", fontSize: 10, fontWeight: "800" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  infoText: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: "600" },
  conflictRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(252,165,165,0.08)",
  },
  conflictText: { color: "#FCA5A5", fontSize: 11, fontWeight: "700", flex: 1 },
  fixBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(252,165,165,0.14)",
  },
  fixBtnText: { color: "#FCA5A5", fontSize: 10, fontWeight: "900" },
  remoteDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: "rgba(5,7,11,0.96)",
    borderTopWidth: 1,
    borderTopColor: "rgba(244,201,93,0.18)",
  },
  remoteTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  remoteHint: { color: "rgba(255,255,255,0.52)", fontSize: 11, marginTop: 2, marginBottom: 8 },
  remoteRow: { gap: 8, paddingRight: 8 },
  remoteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  remoteBtnApprove: { backgroundColor: "rgba(52,211,153,0.12)", borderColor: "rgba(52,211,153,0.35)" },
  remoteBtnDanger: { backgroundColor: "rgba(252,165,165,0.10)", borderColor: "rgba(252,165,165,0.28)" },
  remoteBtnProfile: { backgroundColor: "rgba(125,211,252,0.10)", borderColor: "rgba(125,211,252,0.28)" },
  remoteBtnAssign: { backgroundColor: "rgba(244,201,93,0.12)", borderColor: "rgba(244,201,93,0.35)" },
  remoteBtnDisabled: { opacity: 0.42 },
  remoteBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  remoteBtnTextDisabled: { color: "rgba(255,255,255,0.55)" },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  modalCard: {
    maxHeight: "78%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    backgroundColor: "#0A0F18",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  modalTabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modalTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  modalTabActive: { backgroundColor: "rgba(244,201,93,0.14)", borderWidth: 1, borderColor: "rgba(244,201,93,0.35)" },
  modalTabText: { color: "rgba(255,255,255,0.58)", fontWeight: "800", fontSize: 12 },
  modalTabTextActive: { color: "#F4C95D" },
  modalHelp: { color: "rgba(255,255,255,0.58)", fontSize: 12, marginBottom: 8 },
  searchInput: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 10,
  },
  memberList: { maxHeight: 320 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.12)",
  },
  memberAvatarText: { color: "#F4C95D", fontWeight: "900" },
  memberName: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  memberMeta: { color: "rgba(255,255,255,0.52)", fontSize: 11, marginTop: 2 },
  assignConfirmBtn: {
    marginTop: 8,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#F4C95D",
  },
  assignConfirmText: { color: "#07111F", fontWeight: "900", fontSize: 14 },
});
