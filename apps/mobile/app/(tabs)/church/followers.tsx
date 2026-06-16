import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { fetchChurchFollowers, type ChurchFollower } from "@/src/lib/churchFollowApi";

const BG = "#05070D";
const GOLD = "#D9B35F";
const GOLD_SOFT = "rgba(217,179,95,0.22)";
const MUTED = "rgba(255,255,255,0.58)";

function followerInitial(name: string) {
  return String(name || "F").trim().charAt(0).toUpperCase() || "F";
}

function FollowerRow({ row }: { row: ChurchFollower }) {
  const initial = followerInitial(row.displayName);
  return (
    <View style={styles.row}>
      <View style={styles.avatarRing}>
        {row.avatarUri ? (
          <Image source={{ uri: row.avatarUri }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.displayName}
        </Text>
        <Text style={styles.rowMeta}>Follower</Text>
      </View>
      <Ionicons name="heart" size={16} color={GOLD} />
    </View>
  );
}

export default function ChurchFollowersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();
  const churchId = String(session?.churchId || "").trim();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followers, setFollowers] = useState<ChurchFollower[]>([]);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    try {
      const result = await fetchChurchFollowers(churchId);
      setFollowerCount(result.followerCount);
      setFollowers(result.followers);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [churchId]);

  useEffect(() => {
    void load("initial");
  }, [load]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        pointerEvents="none"
        colors={["#03050A", BG, "#0A101C"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={GOLD} />
        </Pressable>
        <View style={styles.topTitleWrap}>
          <Text style={styles.topTitle}>Followers</Text>
          <Text style={styles.topSubtitle}>{followerCount} total</Text>
        </View>
        <View style={styles.backBtnSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={GOLD} />
          }
          showsVerticalScrollIndicator={false}
        >
          {followers.length ? (
            followers.map((row) => <FollowerRow key={row.userId} row={row} />)
          ) : (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="heart-outline" size={28} color={GOLD} />
              </View>
              <Text style={styles.emptyTitle}>No followers yet.</Text>
              <Text style={styles.emptyBody}>
                When people follow your church from the Home Feed or Church Profile, they will appear here.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnSpacer: {
    width: 40,
  },
  topTitleWrap: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  topTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  topSubtitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(126,180,255,0.14)",
  },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(126,180,255,0.28)",
    backgroundColor: "rgba(126,180,255,0.08)",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#7EB4FF",
    fontSize: 18,
    fontWeight: "900",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  rowMeta: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyCard: {
    marginTop: 40,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: GOLD_SOFT,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(126,180,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(126,180,255,0.22)",
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  emptyBody: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    fontWeight: "600",
  },
});
