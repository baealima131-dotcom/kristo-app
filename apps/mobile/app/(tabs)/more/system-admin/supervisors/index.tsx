import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";
import { hasOfflineActivationRole } from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";
import {
  addSupervisor,
  assignCodesToSupervisor,
  deleteSupervisor,
  fetchActivationDashboard,
  fetchSupervisors,
  type SupervisorSummary,
} from "@/src/lib/offlineActivationCodesApi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

const GOLD = "#F4D06F";
const GOLD_SOFT = "rgba(244,208,111,0.16)";
const PURPLE = "#9C76FF";
const PURPLE_GLOW = "rgba(156,118,255,0.42)";
const RED = "#F87171";
const RED_SOFT = "rgba(248,113,113,0.14)";
const RADIUS = 20;
const RADIUS_SM = 16;
const BLUR = 56;
const GLASS_FILL = "rgba(255,255,255,0.045)";
const GLASS_BORDER = "rgba(255,255,255,0.12)";
const GLASS_BORDER_SOFT = "rgba(255,255,255,0.08)";

function initialsFromName(name: string, fallback = "?"): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function statusMeta(row: SupervisorSummary): {
  label: "Accepted" | "Invited" | "Pending";
  tone: "accepted" | "invited";
} {
  if (row.invitationStatus === "accepted") {
    return { label: "Accepted", tone: "accepted" };
  }
  return { label: "Invited", tone: "invited" };
}

function GlassSurface({
  children,
  style,
  intensity = BLUR,
  radius = RADIUS,
  borderColor = GLASS_BORDER,
}: {
  children: React.ReactNode;
  style?: object;
  intensity?: number;
  radius?: number;
  borderColor?: string;
}) {
  return (
    <View
      style={[
        styles.glassOuter,
        {
          borderRadius: radius,
          borderColor,
          shadowColor: "#000",
        },
        style,
      ]}
    >
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "rgba(255,255,255,0.00)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.glassHighlight,
          { borderTopLeftRadius: radius, borderTopRightRadius: radius },
        ]}
      />
      <View style={styles.glassInner}>{children}</View>
    </View>
  );
}

function BackgroundOrbs() {
  return (
    <>
      <LinearGradient
        colors={["rgba(18,12,32,0.98)", "rgba(7,12,20,0.98)", BG]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={styles.orbPurpleLarge} />
      <View pointerEvents="none" style={styles.orbGoldLarge} />
      <View pointerEvents="none" style={styles.orbPurpleMid} />
    </>
  );
}

function ShimmerList() {
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });

  return (
    <View style={styles.shimmerStack}>
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={[styles.shimmerCard, { opacity }]} />
      ))}
    </View>
  );
}

function HeaderChip({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.headerChip}>
      <Ionicons name={icon} size={13} color={GOLD} />
      <Text style={styles.headerChipLabel}>{label}</Text>
      <Text style={styles.headerChipValue}>{value}</Text>
    </View>
  );
}

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.statChip}>
      <View style={[styles.statChipIconWrap, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <Text style={styles.statChipValue}>{value}</Text>
      <Text style={styles.statChipLabel}>{label}</Text>
    </View>
  );
}

function PremiumButton({
  label,
  icon,
  variant,
  disabled,
  loading,
  onPress,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  style?: object;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 28, bounciness: 0 }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 5 }).start();
  };

  const palette =
    variant === "primary"
      ? { bg: GOLD, border: "rgba(244,208,111,0.65)", text: "#111827" }
      : variant === "danger"
        ? { bg: RED_SOFT, border: "rgba(248,113,113,0.38)", text: RED }
        : { bg: "rgba(255,255,255,0.05)", border: GLASS_BORDER, text: TEXT };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.actionBtn,
          {
            backgroundColor: palette.bg,
            borderColor: palette.border,
            opacity: disabled || loading ? 0.55 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={palette.text} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={15} color={palette.text} /> : null}
            <Text style={[styles.actionBtnText, { color: palette.text }]}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

function SupervisorProfileCard({
  row,
  onAssign,
  onViewDetails,
  onDelete,
  deleting,
}: {
  row: SupervisorSummary;
  onAssign: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const enter = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const isPending = row.invitationStatus === "pending";
  const status = statusMeta(row);
  const displayName = row.fullName || row.kristoId || row.userId;
  const avatarUri = String(row.avatarUrl || "").trim();
  const initials = initialsFromName(displayName, row.kristoId || row.userId);

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          {
            translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
          },
        ],
      }}
    >
      <GlassSurface style={styles.profileCard}>
        <View style={styles.profileTop}>
          <View style={styles.avatarOuter}>
            <View style={styles.avatarGlow} />
            <View style={styles.avatarRing}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <LinearGradient
                  colors={["rgba(156,118,255,0.55)", "rgba(244,208,111,0.35)"]}
                  style={styles.avatarFallback}
                >
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </LinearGradient>
              )}
            </View>
          </View>

          <View style={styles.profileHeadCopy}>
            <Text style={styles.profileName} numberOfLines={2}>
              {displayName}
            </Text>
            <View
              style={[
                styles.statusBadge,
                status.tone === "accepted" ? styles.statusBadgeAccepted : styles.statusBadgeInvited,
              ]}
            >
              <Text style={styles.statusBadgeText}>{status.label}</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Supervisor ID</Text>
            <Text style={styles.infoValue} selectable>
              {row.kristoId || row.userId}
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Assigned Church</Text>
            <Text style={styles.infoValue} numberOfLines={2}>
              {row.churchId || "—"}
            </Text>
          </View>
        </View>

        {!isPending ? (
          <View style={styles.statChipRow}>
            <StatChip icon="layers-outline" label="Assigned" value={row.assignedCodes} color={PURPLE} />
            <StatChip icon="cube-outline" label="Remaining" value={row.remainingCodes} color={GOLD} />
            <StatChip icon="checkmark-done-outline" label="Redeemed" value={row.redeemedCodes} color="#6EE7A8" />
          </View>
        ) : (
          <View style={styles.pendingBanner}>
            <Ionicons name="time-outline" size={16} color={GOLD} />
            <Text style={styles.pendingBannerText}>Awaiting invitation acceptance</Text>
          </View>
        )}

        <View style={styles.cardActions}>
          {!isPending ? (
            <>
              <PremiumButton label="Assign Codes" icon="ticket-outline" variant="primary" onPress={onAssign} />
              <PremiumButton label="View Details" icon="eye-outline" variant="secondary" onPress={onViewDetails} />
            </>
          ) : null}
          <PremiumButton
            label="Delete Supervisor"
            icon="trash-outline"
            variant="danger"
            loading={deleting}
            onPress={onDelete}
            style={isPending ? { flex: 1 } : undefined}
          />
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

export default function SupervisorsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ add?: string }>();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [supervisors, setSupervisors] = React.useState<SupervisorSummary[]>([]);
  const [availableUnassigned, setAvailableUnassigned] = React.useState(0);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const [showAddModal, setShowAddModal] = React.useState(false);
  const [addKristoId, setAddKristoId] = React.useState("");
  const [addChurchId, setAddChurchId] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const [assignTarget, setAssignTarget] = React.useState<SupervisorSummary | null>(null);
  const [assignQuantity, setAssignQuantity] = React.useState("10");
  const [assigning, setAssigning] = React.useState(false);

  const contentFade = React.useRef(new Animated.Value(0)).current;
  const contentSlide = React.useRef(new Animated.Value(16)).current;

  const pendingCount = React.useMemo(
    () => supervisors.filter((row) => row.invitationStatus === "pending").length,
    [supervisors]
  );
  const acceptedCount = React.useMemo(
    () => supervisors.filter((row) => row.invitationStatus === "accepted").length,
    [supervisors]
  );

  const loadData = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const [list, dashboard] = await Promise.all([fetchSupervisors(), fetchActivationDashboard()]);
      setSupervisors(list);
      setAvailableUnassigned(dashboard.stats.availableUnassigned);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load supervisors"));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [loadData])
  );

  React.useEffect(() => {
    if (params.add === "1" && allowed) {
      setShowAddModal(true);
    }
  }, [params.add, allowed]);

  React.useEffect(() => {
    if (loading) return;
    contentFade.setValue(0);
    contentSlide.setValue(16);
    Animated.parallel([
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(contentSlide, {
        toValue: 0,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [loading, contentFade, contentSlide]);

  const onAddSupervisor = async () => {
    const kristoId = String(addKristoId || "").trim();
    const churchId = String(addChurchId || "").trim();
    if (!kristoId || !churchId) {
      Alert.alert("Missing info", "Enter both KRISTO ID and Church ID.");
      return;
    }
    setAdding(true);
    try {
      const result = await addSupervisor({ kristoId, churchId });
      setShowAddModal(false);
      setAddKristoId("");
      setAddChurchId("");
      await loadData();
      if (result.outcome === "alreadySupervisor") {
        Alert.alert("Already supervisor", "This user is already an active Supervisor.");
        return;
      }
      if (result.outcome === "alreadyPending") {
        Alert.alert("Invitation pending", "A pending invitation already exists for this user.");
        return;
      }
      Alert.alert("Invitation sent", "The user must accept before Supervisor access is granted.");
    } catch (e: any) {
      Alert.alert("Could not invite supervisor", String(e?.message || "Failed"));
    } finally {
      setAdding(false);
    }
  };

  const onAssignCodes = async () => {
    if (!assignTarget) return;
    if (assignTarget.invitationStatus === "pending") {
      Alert.alert("Invitation pending", "Codes can only be assigned to accepted supervisors.");
      return;
    }
    const qty = Math.floor(Number(assignQuantity));
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert("Invalid quantity", "Enter at least 1.");
      return;
    }
    if (qty > availableUnassigned) {
      Alert.alert("Not enough codes", `Only ${availableUnassigned} unassigned codes available.`);
      return;
    }

    setAssigning(true);
    try {
      const result = await assignCodesToSupervisor(assignTarget.userId, qty);
      setAssignTarget(null);
      setAssignQuantity("10");
      await loadData();
      Alert.alert("Codes assigned", `${result.assignedCount} codes assigned to supervisor.`);
    } catch (e: any) {
      Alert.alert("Assign failed", String(e?.message || "Failed"));
    } finally {
      setAssigning(false);
    }
  };

  const confirmDeleteSupervisor = (row: SupervisorSummary) => {
    const name = row.fullName || row.kristoId || row.userId;
    const remaining = row.remainingCodes || 0;
    const message =
      row.invitationStatus === "pending"
        ? "This will cancel the pending supervisor invitation. The user will no longer appear in your supervisor list."
        : `Are you sure you want to delete ${name}?\n\nTheir Supervisor access will be revoked immediately. Any unredeemed activation codes (${remaining}) assigned to them will be returned to your unassigned pool. Redeemed codes remain in activation history.`;

    Alert.alert("Delete Supervisor", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void onDeleteSupervisor(row),
      },
    ]);
  };

  const onDeleteSupervisor = async (row: SupervisorSummary) => {
    const rowKey = row.invitationId || row.userId;
    setDeletingId(rowKey);
    try {
      const result = await deleteSupervisor({
        userId: row.userId,
        invitationId: row.invitationId,
      });
      await loadData();
      if (result.outcome === "invitation_cancelled") {
        Alert.alert("Invitation cancelled", "The supervisor invitation has been removed.");
      } else {
        const released = result.releasedCodes;
        Alert.alert(
          "Supervisor deleted",
          released > 0
            ? `${released} unredeemed code${released === 1 ? "" : "s"} returned to your unassigned pool.`
            : "Supervisor access has been revoked."
        );
      }
    } catch (e: any) {
      Alert.alert("Delete failed", String(e?.message || "Could not delete supervisor."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <BackgroundOrbs />

      <View style={[styles.headerWrap, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.backBtnInner}>
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </View>
        </Pressable>

        <GlassSurface style={styles.headerGlass} intensity={48} radius={RADIUS}>
          <View style={styles.headerRow}>
            <View style={styles.headerBadgeOuter}>
              <View style={styles.headerBadgeGlow} />
              <LinearGradient
                colors={["rgba(244,208,111,0.35)", "rgba(156,118,255,0.22)"]}
                style={styles.headerBadge}
              >
                <Ionicons name="people" size={24} color={GOLD} />
              </LinearGradient>
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Supervisors</Text>
              <Text style={styles.subtitle}>Manage activation supervisors and code assignments</Text>
            </View>
          </View>

          <View style={styles.headerChipsRow}>
            <HeaderChip icon="people-outline" label="Total" value={String(supervisors.length)} />
            <HeaderChip icon="ticket-outline" label="Available Codes" value={String(availableUnassigned)} />
            <HeaderChip icon="mail-outline" label="Pending" value={String(pendingCount)} />
          </View>
        </GlassSurface>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <GlassSurface style={styles.noticeCard}>
            <Text style={styles.noticeText}>System Admin access required.</Text>
          </GlassSurface>
        ) : (
          <Animated.View
            style={{
              opacity: contentFade,
              transform: [{ translateY: contentSlide }],
              gap: 14,
            }}
          >
            <PremiumButton
              label="Add Supervisor"
              icon="person-add-outline"
              variant="primary"
              onPress={() => setShowAddModal(true)}
              style={styles.addSupervisorBtn}
            />

            {error ? (
              <GlassSurface style={styles.errorCard} borderColor="rgba(248,113,113,0.35)">
                <Text style={styles.errorText}>{error}</Text>
              </GlassSurface>
            ) : null}

            {loading ? (
              <ShimmerList />
            ) : supervisors.length === 0 ? (
              <GlassSurface style={styles.emptyCard}>
                <View style={styles.emptyIconWrap}>
                  <View style={styles.emptyIconGlow} />
                  <LinearGradient
                    colors={["rgba(156,118,255,0.35)", "rgba(244,208,111,0.22)"]}
                    style={styles.emptyIconCircle}
                  >
                    <Ionicons name="people-outline" size={34} color={GOLD} />
                  </LinearGradient>
                </View>
                <Text style={styles.emptyTitle}>No supervisors yet.</Text>
                <Text style={styles.emptySub}>
                  Invite your first supervisor to begin assigning offline activation codes.
                </Text>
                <PremiumButton
                  label="Invite your first supervisor"
                  icon="person-add-outline"
                  variant="primary"
                  onPress={() => setShowAddModal(true)}
                  style={styles.emptyCta}
                />
              </GlassSurface>
            ) : (
              supervisors.map((row) => {
                const rowKey = row.invitationId || row.userId;
                return (
                  <SupervisorProfileCard
                    key={rowKey}
                    row={row}
                    deleting={deletingId === rowKey}
                    onAssign={() => setAssignTarget(row)}
                    onViewDetails={() =>
                      router.push(
                        `/more/system-admin/supervisors/${encodeURIComponent(row.userId)}` as any
                      )
                    }
                    onDelete={() => confirmDeleteSupervisor(row)}
                  />
                );
              })
            )}

            {!loading && acceptedCount > 0 ? (
              <Text style={styles.footerHint}>
                {acceptedCount} active supervisor{acceptedCount === 1 ? "" : "s"} • {pendingCount} pending invitation
                {pendingCount === 1 ? "" : "s"}
              </Text>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalBackdrop}>
          <GlassSurface style={styles.modalCard} intensity={64}>
            <View style={styles.modalBody}>
              <Text style={styles.modalTitle}>Add Supervisor</Text>
              <Text style={styles.modalSub}>
                Sends a pending invitation. The user must accept before Supervisor access is granted.
              </Text>
              <Text style={styles.fieldLabel}>KRISTO ID</Text>
              <TextInput
                value={addKristoId}
                onChangeText={setAddKristoId}
                placeholder="KR7-000123"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="characters"
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Church ID</Text>
              <TextInput
                value={addChurchId}
                onChangeText={setAddChurchId}
                placeholder="CH7-08PQW9"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="characters"
                style={styles.input}
              />
              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancel} onPress={() => setShowAddModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.modalConfirm} disabled={adding} onPress={onAddSupervisor}>
                  {adding ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <Text style={styles.modalConfirmText}>Add</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </GlassSurface>
        </View>
      </Modal>

      <Modal
        visible={Boolean(assignTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setAssignTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <GlassSurface style={styles.modalCard} intensity={64}>
            <View style={styles.modalBody}>
              <Text style={styles.modalTitle}>Assign codes</Text>
              <Text style={styles.modalSub}>
                {assignTarget?.fullName || assignTarget?.kristoId || assignTarget?.userId}
              </Text>
              <Text style={styles.modalHint}>{availableUnassigned} unassigned codes available</Text>
              <TextInput
                value={assignQuantity}
                onChangeText={setAssignQuantity}
                keyboardType="number-pad"
                placeholder="10"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
              />
              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancel} onPress={() => setAssignTarget(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.modalConfirm} disabled={assigning} onPress={onAssignCodes}>
                  {assigning ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <Text style={styles.modalConfirmText}>Assign</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </GlassSurface>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  orbPurpleLarge: {
    position: "absolute",
    top: -100,
    right: -70,
    width: 300,
    height: 300,
    borderRadius: 999,
    backgroundColor: PURPLE_GLOW,
    opacity: 0.34,
  },
  orbGoldLarge: {
    position: "absolute",
    top: 220,
    left: -100,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.12)",
    opacity: 0.5,
  },
  orbPurpleMid: {
    position: "absolute",
    bottom: 80,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: "rgba(156,118,255,0.16)",
    opacity: 0.4,
  },
  headerWrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: RADIUS_SM,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
  },
  backBtnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerGlass: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: TEXT, fontSize: 24, fontWeight: "900", letterSpacing: 0.3 },
  subtitle: { color: MUTED, fontSize: 12, lineHeight: 17 },
  headerBadgeOuter: { position: "relative" },
  headerBadgeGlow: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.16)",
  },
  headerBadge: {
    width: 50,
    height: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.35)",
  },
  headerChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  headerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
  },
  headerChipLabel: { color: MUTED, fontSize: 10, fontWeight: "700" },
  headerChipValue: { color: GOLD, fontSize: 11, fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  glassOuter: {
    overflow: "hidden",
    borderWidth: 1,
    backgroundColor: GLASS_FILL,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 8,
  },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  glassInner: { padding: 16 },
  addSupervisorBtn: { alignSelf: "stretch" },
  profileCard: { marginBottom: 0 },
  profileTop: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  avatarOuter: { position: "relative" },
  avatarGlow: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 999,
    backgroundColor: "rgba(244,208,111,0.20)",
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(244,208,111,0.45)",
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: TEXT, fontSize: 22, fontWeight: "900" },
  profileHeadCopy: { flex: 1, minWidth: 0, gap: 8 },
  profileName: { color: TEXT, fontSize: 18, fontWeight: "900", lineHeight: 24 },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeAccepted: {
    borderColor: "rgba(110,231,168,0.40)",
    backgroundColor: "rgba(110,231,168,0.12)",
  },
  statusBadgeInvited: {
    borderColor: "rgba(244,208,111,0.42)",
    backgroundColor: "rgba(244,208,111,0.12)",
  },
  statusBadgeText: { color: TEXT, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  infoSection: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: RADIUS_SM,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
    marginBottom: 14,
  },
  infoBlock: { flex: 1, minWidth: 0, gap: 4 },
  infoLabel: { color: MUTED, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  infoValue: { color: TEXT, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  infoDivider: { width: 1, backgroundColor: GLASS_BORDER_SOFT },
  statChipRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  statChip: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: RADIUS_SM,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
  },
  statChipIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  statChipValue: { color: TEXT, fontSize: 18, fontWeight: "900" },
  statChipLabel: { color: MUTED, fontSize: 10, fontWeight: "700", textAlign: "center" },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: RADIUS_SM,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    marginBottom: 14,
  },
  pendingBannerText: { color: GOLD, fontSize: 12, fontWeight: "700", flex: 1 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtn: {
    flex: 1,
    minWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: "800" },
  emptyCard: { alignItems: "center", paddingVertical: 28 },
  emptyIconWrap: { position: "relative", marginBottom: 16 },
  emptyIconGlow: {
    position: "absolute",
    top: -12,
    left: -12,
    right: -12,
    bottom: -12,
    borderRadius: 999,
    backgroundColor: "rgba(156,118,255,0.22)",
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.30)",
  },
  emptyTitle: { color: TEXT, fontSize: 18, fontWeight: "900", marginBottom: 6 },
  emptySub: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19, marginBottom: 18, paddingHorizontal: 12 },
  emptyCta: { alignSelf: "stretch", minWidth: 220 },
  shimmerStack: { gap: 12 },
  shimmerCard: {
    height: 220,
    borderRadius: RADIUS,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: GLASS_BORDER_SOFT,
  },
  noticeCard: { padding: 18 },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center" },
  errorCard: { padding: 12 },
  errorText: { color: "#FCA5A5", fontSize: 13 },
  footerHint: { color: MUTED, fontSize: 11, textAlign: "center", marginTop: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {},
  modalBody: { gap: 10 },
  modalTitle: { color: TEXT, fontSize: 18, fontWeight: "900" },
  modalSub: { color: MUTED, fontSize: 13, lineHeight: 18 },
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 4 },
  modalHint: { color: MUTED, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: RADIUS_SM,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT,
    backgroundColor: "rgba(255,255,255,0.04)",
    fontSize: 15,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  modalCancelText: { color: MUTED, fontWeight: "700" },
  modalConfirm: {
    minWidth: 88,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS_SM,
    backgroundColor: GOLD,
  },
  modalConfirmText: { color: "#111", fontWeight: "900" },
});
