import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  fetchSokoWorkforceMe,
  respondSokoWorkforceInvitation,
  type SokoWorkStage,
  type SokoWorkforceRecord,
} from "@/src/lib/sokoWorkforceApi";

const LABELS: Record<SokoWorkStage, string> = {
  supply: "Supply & sourcing",
  setup: "Product setup",
  costing: "Cost & pricing",
  payments: "Payments",
  review: "Final review",
};

export default function SokoWorkInvitationScreen() {
  const router = useRouter();
  const [items, setItems] = useState<SokoWorkforceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await fetchSokoWorkforceMe();
      setItems(result.pendingInvitations);
    } catch (e: any) {
      setError(String(e?.message || "Could not load SOKO work invitations."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const respond = async (
    invitation: SokoWorkforceRecord,
    action: "accept" | "decline"
  ) => {
    try {
      setBusyId(invitation.id);
      const updated = await respondSokoWorkforceInvitation({
        invitationId: invitation.id,
        action,
      });

      if (action === "accept" && updated.status === "accepted") {
        Alert.alert(
          "Job accepted",
          "Your SOKO Work dashboard is now available inside More."
        );
        router.replace("/more" as any);
        return;
      }

      await load();
    } catch (e: any) {
      Alert.alert("SOKO Work", String(e?.message || e));
    } finally {
      setBusyId("");
    }
  };

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>SOKO Job Invitation</Text>
          <Text style={s.sub}>REVIEW BEFORE ACCEPTING</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {loading ? (
          <ActivityIndicator color="#DDF25B" />
        ) : error ? (
          <Text style={s.error}>{error}</Text>
        ) : items.length === 0 ? (
          <Text style={s.empty}>No pending SOKO job invitations.</Text>
        ) : (
          items.map((inv) => (
            <LinearGradient
              key={inv.id}
              colors={["#183B31", "#0F271F", "#091712"]}
              style={s.card}
            >
              <Text style={s.seller}>{inv.sellerDisplayName || "SOKO Seller"}</Text>
              <Text style={s.pending}>PENDING JOB INVITATION</Text>

              <Text style={s.meta}>Work level: {LABELS[inv.stage]}</Text>
              <Text style={s.meta}>Church ID: {inv.churchId}</Text>
              <Text style={s.meta}>KRISTO ID: {inv.inviteeKristoId}</Text>

              <View style={s.actions}>
                <Pressable
                  disabled={busyId === inv.id}
                  onPress={() => void respond(inv, "decline")}
                  style={s.decline}
                >
                  <Text style={s.declineText}>Decline</Text>
                </Pressable>

                <Pressable
                  disabled={busyId === inv.id}
                  onPress={() => void respond(inv, "accept")}
                  style={s.accept}
                >
                  {busyId === inv.id ? (
                    <ActivityIndicator color="#10271F" />
                  ) : (
                    <Text style={s.acceptText}>Accept job</Text>
                  )}
                </Pressable>
              </View>
            </LinearGradient>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#080D17" },
  header: {
    minHeight: 64,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  title: { color: "#fff", fontSize: 18, fontWeight: "900" },
  sub: { color: "#9AA4B0", fontSize: 8, marginTop: 2, letterSpacing: 1 },
  content: { padding: 16, paddingBottom: 60 },
  error: { color: "#FF9A9A", textAlign: "center", marginTop: 40 },
  empty: { color: "#9AA4B0", textAlign: "center", marginTop: 40 },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(221,242,91,0.18)",
    padding: 17,
    marginBottom: 14,
  },
  seller: { color: "#fff", fontSize: 16, fontWeight: "900" },
  pending: { color: "#DDF25B", fontSize: 8, fontWeight: "900", marginTop: 4 },
  meta: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    marginTop: 12,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  decline: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,137,147,0.3)",
  },
  declineText: { color: "#FF8993", fontWeight: "900" },
  accept: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DDF25B",
  },
  acceptText: { color: "#10271F", fontWeight: "900" },
});
