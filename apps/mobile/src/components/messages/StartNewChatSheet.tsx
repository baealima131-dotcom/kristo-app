import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import {
  openDirectMessageThread,
  resolveDirectMessagePeer,
  type DirectMessagePeerPreview,
  type DirectMessageThread,
} from "@/src/lib/directMessagesApi";
import { getSessionSync } from "@/src/lib/kristoSession";

const BG = "#0A1220";
const TEXT = "rgba(255,255,255,0.94)";
const GOLD = "rgba(217,179,95,0.92)";

type TabKey = "church" | "kristo";

type ChurchMemberRow = {
  userId: string;
  name: string;
  avatarUri: string;
  kristoId: string;
  status: string;
};

function cleanKristoId(value: string) {
  return String(value || "").trim().toUpperCase();
}

function memberInitial(name: string) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function isActiveMember(row: any) {
  const status = String(row?.status || row?.membershipStatus || "active").trim().toLowerCase();
  return status === "active";
}

function mapMemberRow(row: any): ChurchMemberRow | null {
  const userId = String(row?.userId || row?.id || "").trim();
  if (!userId) return null;
  return {
    userId,
    name: String(row?.name || row?.displayName || row?.fullName || "Church member").trim(),
    avatarUri: String(row?.avatarUrl || row?.avatarUri || "").trim(),
    kristoId: cleanKristoId(row?.kristoId || row?.userCode || ""),
    status: String(row?.status || row?.membershipStatus || "active"),
  };
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onStarted: (thread: DirectMessageThread) => void;
};

export function StartNewChatSheet({ visible, onClose, onStarted }: Props) {
  const insets = useSafeAreaInsets();
  const selfUserId = String(getSessionSync()?.userId || "").trim();

  const [tab, setTab] = useState<TabKey>("church");
  const [churchQuery, setChurchQuery] = useState("");
  const [members, setMembers] = useState<ChurchMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [kristoId, setKristoId] = useState("");
  const [churchId, setChurchId] = useState("");
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [resolvedPeer, setResolvedPeer] = useState<DirectMessagePeerPreview | null>(null);

  const [startingUserId, setStartingUserId] = useState("");
  const [startError, setStartError] = useState("");

  const resetState = useCallback(() => {
    setTab("church");
    setChurchQuery("");
    setMembers([]);
    setMembersLoading(false);
    setMembersError("");
    setKristoId("");
    setChurchId("");
    setResolveLoading(false);
    setResolveError("");
    setResolvedPeer(null);
    setStartingUserId("");
    setStartError("");
  }, []);

  useEffect(() => {
    if (!visible) {
      resetState();
      return;
    }

    let alive = true;
    setMembersLoading(true);
    setMembersError("");

    void fetchChurchMembers()
      .then((rows) => {
        if (!alive) return;
        const mapped = (Array.isArray(rows) ? rows : [])
          .filter(isActiveMember)
          .map(mapMemberRow)
          .filter((row): row is ChurchMemberRow => Boolean(row))
          .filter((row) => row.userId !== selfUserId);
        setMembers(mapped);
      })
      .catch((error) => {
        if (!alive) return;
        setMembers([]);
        setMembersError(String((error as Error)?.message || error || "Could not load church members."));
      })
      .finally(() => {
        if (alive) setMembersLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [visible, resetState, selfUserId]);

  const filteredMembers = useMemo(() => {
    const query = churchQuery.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => {
      const haystack = `${member.name} ${member.kristoId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [churchQuery, members]);

  const startChat = useCallback(
    async (args: { targetUserId: string; churchId?: string }) => {
      const targetUserId = String(args.targetUserId || "").trim();
      if (!targetUserId || startingUserId) return;

      setStartingUserId(targetUserId);
      setStartError("");

      try {
        const thread = await openDirectMessageThread({
          targetUserId,
          churchId: args.churchId,
        });
        onClose();
        onStarted(thread);
      } catch (error) {
        setStartError(String((error as Error)?.message || error || "Could not start chat."));
      } finally {
        setStartingUserId("");
      }
    },
    [onClose, onStarted, startingUserId]
  );

  const handleResolvePeer = useCallback(async () => {
    const nextKristoId = cleanKristoId(kristoId);
    const nextChurchId = String(churchId || "").trim();
    if (!nextKristoId || !nextChurchId) {
      setResolveError("Enter both Kristo ID and Church ID.");
      setResolvedPeer(null);
      return;
    }

    setResolveLoading(true);
    setResolveError("");
    setResolvedPeer(null);

    try {
      const peer = await resolveDirectMessagePeer({
        kristoId: nextKristoId,
        churchId: nextChurchId,
      });
      if (peer.userId === selfUserId) {
        setResolveError("You cannot start a chat with yourself.");
        return;
      }
      setResolvedPeer(peer);
    } catch (error) {
      setResolveError(
        String(
          (error as Error)?.message ||
            error ||
            "We could not find an active member with that Kristo ID in that church."
        )
      );
    } finally {
      setResolveLoading(false);
    }
  }, [churchId, kristoId, selfUserId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={s.handle} />
          <Text style={s.title}>Start new chat</Text>
          <Text style={s.subtitle}>Person-to-person messages only.</Text>

          <View style={s.tabRow}>
            <Pressable
              onPress={() => setTab("church")}
              style={({ pressed }) => [
                s.tabBtn,
                tab === "church" ? s.tabBtnActive : null,
                pressed ? s.pressed : null,
              ]}
            >
              <Text style={[s.tabBtnText, tab === "church" ? s.tabBtnTextActive : null]}>
                Church Member
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab("kristo")}
              style={({ pressed }) => [
                s.tabBtn,
                tab === "kristo" ? s.tabBtnActive : null,
                pressed ? s.pressed : null,
              ]}
            >
              <Text style={[s.tabBtnText, tab === "kristo" ? s.tabBtnTextActive : null]}>
                Kristo ID + Church ID
              </Text>
            </Pressable>
          </View>

          {tab === "church" ? (
            <>
              <View style={s.searchWrap}>
                <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
                <TextInput
                  value={churchQuery}
                  onChangeText={setChurchQuery}
                  placeholder="Search church members"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={s.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {membersLoading ? (
                <View style={s.loadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : (
                <FlatList
                  data={filteredMembers}
                  keyExtractor={(item) => item.userId}
                  style={s.list}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={filteredMembers.length ? undefined : s.listEmpty}
                  renderItem={({ item }) => {
                    const busy = startingUserId === item.userId;
                    return (
                      <Pressable
                        onPress={() => void startChat({ targetUserId: item.userId })}
                        disabled={Boolean(startingUserId)}
                        style={({ pressed }) => [s.memberRow, pressed ? s.pressed : null]}
                      >
                        <View style={s.avatarWrap}>
                          {item.avatarUri ? (
                            <Image source={{ uri: item.avatarUri }} style={s.avatarImage} />
                          ) : (
                            <View style={s.avatarFallback}>
                              <Text style={s.avatarFallbackText}>{memberInitial(item.name)}</Text>
                            </View>
                          )}
                        </View>
                        <View style={s.memberBody}>
                          <Text style={s.memberName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          {item.kristoId ? (
                            <Text style={s.memberSub} numberOfLines={1}>
                              {item.kristoId}
                            </Text>
                          ) : null}
                        </View>
                        {busy ? (
                          <ActivityIndicator color={GOLD} size="small" />
                        ) : (
                          <Ionicons name="chatbubble-outline" size={18} color={GOLD} />
                        )}
                      </Pressable>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={s.emptyText}>
                      {membersError || "No active church members found."}
                    </Text>
                  }
                />
              )}
            </>
          ) : (
            <View style={s.kristoPane}>
              <Text style={s.fieldLabel}>Kristo ID</Text>
              <TextInput
                value={kristoId}
                onChangeText={(value) => {
                  setKristoId(value);
                  setResolvedPeer(null);
                  setResolveError("");
                }}
                placeholder="KR7-25023WY"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={s.fieldInput}
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <Text style={s.fieldLabel}>Church ID</Text>
              <TextInput
                value={churchId}
                onChangeText={(value) => {
                  setChurchId(value);
                  setResolvedPeer(null);
                  setResolveError("");
                }}
                placeholder="church_..."
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={s.fieldInput}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                onPress={() => void handleResolvePeer()}
                disabled={resolveLoading}
                style={({ pressed }) => [s.lookupBtn, pressed ? s.pressed : null]}
              >
                {resolveLoading ? (
                  <ActivityIndicator color={BG} />
                ) : (
                  <Text style={s.lookupBtnText}>Look up member</Text>
                )}
              </Pressable>

              {resolveError ? <Text style={s.errorText}>{resolveError}</Text> : null}

              {resolvedPeer ? (
                <View style={s.previewCard}>
                  <View style={s.avatarWrap}>
                    {resolvedPeer.avatarUrl ? (
                      <Image source={{ uri: resolvedPeer.avatarUrl }} style={s.avatarImage} />
                    ) : (
                      <View style={s.avatarFallback}>
                        <Text style={s.avatarFallbackText}>
                          {memberInitial(resolvedPeer.displayName)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={s.previewBody}>
                    <Text style={s.memberName} numberOfLines={1}>
                      {resolvedPeer.displayName}
                    </Text>
                    <Text style={s.memberSub} numberOfLines={1}>
                      {resolvedPeer.kristoId}
                    </Text>
                    <Text style={s.memberSub} numberOfLines={1}>
                      {resolvedPeer.churchName}
                    </Text>
                  </View>
                </View>
              ) : null}

              {resolvedPeer ? (
                <Pressable
                  onPress={() =>
                    void startChat({
                      targetUserId: resolvedPeer.userId,
                      churchId: resolvedPeer.churchId,
                    })
                  }
                  disabled={Boolean(startingUserId)}
                  style={({ pressed }) => [s.startBtn, pressed ? s.pressed : null]}
                >
                  {startingUserId === resolvedPeer.userId ? (
                    <ActivityIndicator color={BG} />
                  ) : (
                    <Text style={s.startBtnText}>Start Chat</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          )}

          {startError ? <Text style={s.errorText}>{startError}</Text> : null}

          <Pressable onPress={onClose} style={({ pressed }) => [s.cancelBtn, pressed ? s.pressed : null]}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  } as ViewStyle,
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 16,
    paddingTop: 10,
  } as ViewStyle,
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 12,
  } as ViewStyle,
  title: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 20,
  } as TextStyle,
  subtitle: {
    marginTop: 4,
    marginBottom: 14,
    color: "rgba(255,255,255,0.58)",
    fontWeight: "700",
    fontSize: 13,
  } as TextStyle,
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  } as ViewStyle,
  tabBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  tabBtnActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.35)",
  } as ViewStyle,
  tabBtnText: {
    color: "rgba(255,255,255,0.62)",
    fontWeight: "800",
    fontSize: 12,
    textAlign: "center",
  } as TextStyle,
  tabBtnTextActive: {
    color: GOLD,
  } as TextStyle,
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 10,
  } as ViewStyle,
  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 8,
  } as TextStyle,
  list: {
    maxHeight: 320,
  } as ViewStyle,
  listEmpty: {
    paddingVertical: 28,
  } as ViewStyle,
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  avatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  avatarImage: {
    width: "100%",
    height: "100%",
  } as ImageStyle,
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  } as ViewStyle,
  avatarFallbackText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 16,
  } as TextStyle,
  memberBody: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  memberName: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 15,
  } as TextStyle,
  memberSub: {
    marginTop: 2,
    color: "rgba(255,255,255,0.58)",
    fontWeight: "700",
    fontSize: 12,
  } as TextStyle,
  loadingWrap: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  emptyText: {
    color: "rgba(255,255,255,0.58)",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  } as TextStyle,
  kristoPane: {
    gap: 8,
  } as ViewStyle,
  fieldLabel: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "800",
    fontSize: 12,
    marginTop: 4,
  } as TextStyle,
  fieldInput: {
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: TEXT,
    fontWeight: "700",
    fontSize: 15,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as TextStyle,
  lookupBtn: {
    marginTop: 6,
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  } as ViewStyle,
  lookupBtnText: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 14,
  } as TextStyle,
  previewCard: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  previewBody: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  startBtn: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  } as ViewStyle,
  startBtnText: {
    color: BG,
    fontWeight: "900",
    fontSize: 15,
  } as TextStyle,
  errorText: {
    marginTop: 8,
    color: "#FF8A8A",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  } as TextStyle,
  cancelBtn: {
    marginTop: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  cancelBtnText: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "800",
    fontSize: 14,
  } as TextStyle,
  pressed: {
    opacity: 0.86,
  } as ViewStyle,
});
