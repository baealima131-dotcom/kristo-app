import React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  fetchMyOfflineActivationInvitations,
  respondToOfflineActivationInvitation,
  type OfflineActivationInvitation,
} from "@/src/lib/offlineActivationInvitationsApi";
import { clearResponseCacheForRequest } from "@/src/lib/kristoTraffic";

const ACCENT = "#5A9CFF";

type Props = {
  variant?: "more" | "profile";
};

export function SupervisorInvitationCard({ variant = "more" }: Props) {
  const { session, setSession } = useKristoSession();
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState("");
  const [invitations, setInvitations] = React.useState<OfflineActivationInvitation[]>([]);

  const loadInvitations = React.useCallback(async () => {
    const userId = String(session?.userId || "").trim();
    if (!userId) {
      setInvitations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await fetchMyOfflineActivationInvitations();
      setInvitations(
        rows.filter((row) => row.role === "Supervisor" && row.status === "pending")
      );
    } catch {
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [session?.userId]);

  useFocusEffect(
    React.useCallback(() => {
      void loadInvitations();
    }, [loadInvitations])
  );

  const onRespond = async (invitation: OfflineActivationInvitation, action: "accept" | "decline") => {
    if (!session) return;
    setBusyId(invitation.id);
    try {
      const result = await respondToOfflineActivationInvitation({
        invitationId: invitation.id,
        action,
      });

      if (action === "accept" && result.platformRole) {
        const next = {
          ...session,
          platformRole: result.platformRole,
          offlineActivationRole: result.offlineActivationRole || result.platformRole,
        };
        await setSession(next);
        console.log("KRISTO_SUPERVISOR_INVITE_ACCEPTED_SESSION_SYNC", {
          userId: session.userId,
          platformRole: result.platformRole,
        });
      }

      clearResponseCacheForRequest("GET", "/api/auth/profile", session.userId);
      clearResponseCacheForRequest("GET", "/api/offline-activation/invitations", session.userId);
      await loadInvitations();
    } catch (error: any) {
      Alert.alert(
        action === "accept" ? "Could not accept" : "Could not decline",
        String(error?.message || "Failed")
      );
    } finally {
      setBusyId("");
    }
  };

  if (loading || invitations.length === 0) {
    return null;
  }

  return (
    <View style={[styles.wrap, variant === "profile" ? styles.wrapProfile : null]}>
      {invitations.map((invitation) => {
        const busy = busyId === invitation.id;
        return (
          <View key={invitation.id} style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="people-circle-outline" size={22} color={ACCENT} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>Supervisor invitation</Text>
              <Text style={styles.subtitle}>
                You were invited to manage activation codes for {invitation.churchId}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.acceptBtn, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => void onRespond(invitation, "accept")}
                >
                  {busy ? (
                    <ActivityIndicator color="#07111F" size="small" />
                  ) : (
                    <Text style={styles.acceptText}>Accept</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.declineBtn, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => void onRespond(invitation, "decline")}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  wrapProfile: {
    paddingHorizontal: 0,
    paddingBottom: 16,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(90,156,255,0.35)",
    backgroundColor: "rgba(90,156,255,0.10)",
    padding: 14,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(90,156,255,0.18)",
  },
  body: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
  },
  subtitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  acceptBtn: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4D06F",
  },
  acceptText: {
    color: "#07111F",
    fontWeight: "800",
    fontSize: 13,
  },
  declineBtn: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  declineText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.55,
  },
});
