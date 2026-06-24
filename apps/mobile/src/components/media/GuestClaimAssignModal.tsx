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
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import { assignScheduleSlotOnServer } from "@/src/lib/guestClaimSlotAssign";
import {
  assignChurchLiveControlRoomScheduleSlot,
  isGuestCenterChurchLiveControlRoomSource,
} from "@/src/lib/churchLiveControlGuestCenterMutations";
import { isValidKristoAssignId, slotHasClaimant } from "@/src/lib/guestClaimCenterUtils";

type GuestClaimAssignModalProps = {
  visible: boolean;
  slot: any | null;
  churchId: string;
  sessionUserId: string;
  apiHeaders: Record<string, string>;
  guestCenterSource?: string;
  guestCenterReloadOpts?: {
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  };
  onSetChurchLiveControlRoomSchedule?: (schedule: any | null) => void;
  onClose: () => void;
  onAssigned: () => void;
};

export function GuestClaimAssignModal(props: GuestClaimAssignModalProps) {
  const {
    visible,
    slot,
    churchId,
    sessionUserId,
    apiHeaders,
    guestCenterSource,
    guestCenterReloadOpts,
    onSetChurchLiveControlRoomSchedule,
    onClose,
    onAssigned,
  } = props;

  const [assignTab, setAssignTab] = useState<"members" | "kristo">("members");
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [kristoDraft, setKristoDraft] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");

  const selectedFeedId = String(slot?.sourceFeedId || "").trim();
  const useRoomMutation = isGuestCenterChurchLiveControlRoomSource(String(guestCenterSource || ""));

  useEffect(() => {
    if (!visible) {
      setAssignTab("members");
      setKristoDraft("");
      setMemberQuery("");
      setAssignBusy(false);
    }
  }, [visible]);

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
    if (visible && assignTab === "members" && !members.length && !membersLoading) {
      void loadMembers();
    }
  }, [visible, assignTab, members.length, membersLoading, loadMembers]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => {
      const name = String(member?.name || member?.displayName || "").toLowerCase();
      const code = String(member?.kristoId || member?.userCode || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [memberQuery, members]);

  const assignMember = useCallback(
    async (member: { userId?: string; kristoId?: string; name?: string; role?: string; avatarUri?: string }) => {
      if (!slot) return;
      if (!selectedFeedId) {
        Alert.alert("Assign member", "This slot is not linked to a published schedule yet.");
        return;
      }
      if (slotHasClaimant(slot)) {
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
        if (useRoomMutation) {
          const result = await assignChurchLiveControlRoomScheduleSlot({
            slot: {
              ...slot,
              id: String(slot?.id || "").trim(),
              roomMessageId: String(slot?.roomMessageId || "").trim(),
            },
            headers: apiHeaders,
            churchId,
            userId: sessionUserId,
            assignee: {
              userId: member.userId,
              name: member.name,
              role: member.role,
              avatarUri: member.avatarUri,
            },
            reloadOpts: guestCenterReloadOpts,
          });
          if (!result.ok) {
            throw new Error(String(result.error || "Could not assign member to this slot."));
          }
          onSetChurchLiveControlRoomSchedule?.(result.schedule);
        } else {
          await assignScheduleSlotOnServer({
            postId: selectedFeedId,
            slotId: String(slot.id),
            userId: member.userId,
            kristoId: member.kristoId,
            name: member.name,
            role: member.role,
            avatarUri: member.avatarUri,
            headers: apiHeaders,
          });
        }
        onClose();
        onAssigned();
        Alert.alert("Assigned", `${member.name || "Member"} was assigned to this slot.`);
      } catch (e: any) {
        Alert.alert("Assign failed", String(e?.message || "Could not assign member."));
      } finally {
        setAssignBusy(false);
      }
    },
    [
      apiHeaders,
      churchId,
      guestCenterReloadOpts,
      onAssigned,
      onClose,
      onSetChurchLiveControlRoomSchedule,
      selectedFeedId,
      sessionUserId,
      slot,
      useRoomMutation,
    ]
  );

  const assignByKristoId = useCallback(async () => {
    const code = String(kristoDraft || "").trim().toUpperCase();
    if (!isValidKristoAssignId(code)) {
      Alert.alert("Kristo ID", "Use a valid Kristo ID like KR7-25023WY.");
      return;
    }
    await assignMember({ kristoId: code });
  }, [assignMember, kristoDraft]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign member</Text>
            <Pressable onPress={onClose} hitSlop={12}>
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
                style={[styles.assignConfirmBtn, assignBusy ? styles.assignConfirmBtnDisabled : null]}
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
  );
}

const styles = StyleSheet.create({
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
  assignConfirmBtnDisabled: { opacity: 0.72 },
  assignConfirmText: { color: "#07111F", fontWeight: "900", fontSize: 14 },
});
