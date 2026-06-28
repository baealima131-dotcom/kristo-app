import React from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BackgroundScene,
  GlassSurface,
  GoldPrimaryButton,
  OfflineActivationHeroHeader,
} from "@/src/components/offlineActivationAdminDashboardUi";
import { GlassButton } from "@/src/components/systemAdminSupervisorUi";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { fetchAgentInvitations, type AgentInvitationRecord } from "@/src/lib/offlineActivationAgentApi";
import {
  OFFLINE_AGENT_INVITE_BODY,
  OFFLINE_AGENT_INVITE_TITLE,
  buildOfflineAgentReferenceChurchLabel,
  respondOfflineAgentProfileInvite,
} from "@/src/lib/profileOfflineAgentInvites";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

const GOLD = "#F4D06F";

export default function AgentInvitationReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ invitationId?: string }>();
  const { session, setSession } = useKristoSession();

  const [loading, setLoading] = React.useState(true);
  const [responding, setResponding] = React.useState(false);
  const [invite, setInvite] = React.useState<AgentInvitationRecord | null>(null);
  const [error, setError] = React.useState("");

  const loadInvite = React.useCallback(async () => {
    if (!session?.userId) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const rows = await fetchAgentInvitations();
      const targetId = String(params.invitationId || "").trim();
      const match = targetId
        ? rows.find((row) => row.id === targetId) || null
        : rows[0] || null;
      setInvite(match);
      if (!match) setError("No pending agent invitation found.");
    } catch (e: any) {
      setError(String(e?.message || "Failed to load invitation"));
    } finally {
      setLoading(false);
    }
  }, [params.invitationId, session?.userId]);

  React.useEffect(() => {
    void loadInvite();
  }, [loadInvite]);

  const onRespond = async (action: "accept" | "decline") => {
    if (!invite || !session) return;
    setResponding(true);
    try {
      await respondOfflineAgentProfileInvite({
        session,
        invitationId: invite.id,
        action,
        setSession,
      });
      if (action === "accept") {
        Alert.alert("Invitation accepted", "Your Agent workspace is now available in More.", [
          { text: "Open Agent", onPress: () => router.replace("/more/agent" as any) },
          { text: "Done", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Invitation declined", "You can accept later if your supervisor re-invites you.");
        router.back();
      }
    } catch (e: any) {
      Alert.alert("Could not respond", String(e?.message || "Failed"));
    } finally {
      setResponding(false);
    }
  };

  const supervisorLabel = React.useMemo(() => {
    if (!invite) return "—";
    const supervisorId = String(invite.invitedByUserId || "").trim();
    return supervisorId || "—";
  }, [invite]);

  return (
    <View style={[styles.screen, { backgroundColor: BG }]}>
      <BackgroundScene />
      <OfflineActivationHeroHeader
        title="Agent Invitation"
        subtitle="Review and respond"
        badgeIcon="key-outline"
        onBack={() => router.back()}
        topInset={insets.top}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={GOLD} />
          </View>
        ) : error ? (
          <GlassSurface style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
          </GlassSurface>
        ) : invite ? (
          <>
            <GlassSurface style={styles.card}>
              <View style={styles.iconRow}>
                <LinearGradient
                  colors={["rgba(96,152,255,0.28)", "rgba(244,208,111,0.18)"]}
                  style={styles.iconBadge}
                >
                  <Ionicons name="key-outline" size={22} color={GOLD} />
                </LinearGradient>
                <View style={styles.headText}>
                  <Text style={styles.title}>{OFFLINE_AGENT_INVITE_TITLE}</Text>
                  <Text style={styles.sub}>{OFFLINE_AGENT_INVITE_BODY}</Text>
                </View>
              </View>

              <View style={styles.metaBlock}>
                <MetaRow label="Status" value="Pending" />
                <MetaRow label="KRISTO ID" value={invite.inviteeKristoId || "—"} />
                <MetaRow label="Church" value={buildOfflineAgentReferenceChurchLabel(invite.churchId)} />
                <MetaRow label="Supervisor" value={supervisorLabel} />
                {invite.createdAt ? (
                  <MetaRow
                    label="Invited"
                    value={new Date(invite.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  />
                ) : null}
              </View>
            </GlassSurface>

            <Text style={styles.helper}>
              Accepting grants the Agent platform role and opens your workspace for code delivery and
              church activation.
            </Text>

            <GoldPrimaryButton
              label={responding ? "Accepting…" : "Accept invitation"}
              onPress={() => void onRespond("accept")}
              disabled={responding}
            />
            <View style={{ height: 10 }} />
            <GlassButton
              label={responding ? "Working…" : "Decline"}
              onPress={() => {
                if (!responding) void onRespond("decline");
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  center: { paddingVertical: 48, alignItems: "center" },
  card: { padding: 14, gap: 14 },
  iconRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  headText: { flex: 1, gap: 6 },
  title: { color: TEXT, fontSize: 18, fontWeight: "900" },
  sub: { color: MUTED, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  metaBlock: { gap: 10, paddingTop: 4 },
  metaRow: { gap: 2 },
  metaLabel: { color: MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  metaValue: { color: TEXT, fontSize: 13, fontWeight: "700" },
  helper: { color: MUTED, fontSize: 12, lineHeight: 17, fontWeight: "600", paddingHorizontal: 4 },
  errorText: { color: "#FCA5A5", fontSize: 13, fontWeight: "700" },
});
