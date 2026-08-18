import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useRouter,
} from "expo-router";
import {
  Ionicons,
} from "@expo/vector-icons";
import {
  LinearGradient,
} from "expo-linear-gradient";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  getSessionSync,
} from "@/src/lib/kristoSession";
import {
  hasOfflineActivationRole,
} from "@/src/lib/offlineActivationCodes";
import {
  resolveSessionPlatformRole,
} from "@/src/lib/platformRole";
import {
  fetchSokoSellerApplications,
  reviewSokoSellerApplication,
  type SokoSellerApplication,
} from "@/src/lib/sokoSellerAccessApi";

const BG = "#080C14";
const TEXT = "rgba(255,255,255,0.96)";
const MUTED = "rgba(255,255,255,0.60)";
const GOLD = "#F4D06F";
const GREEN = "#5DEBA5";
const PINK = "#FF8CC8";
const PURPLE = "#B9A2FF";

type Filter =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";

function formatDate(value?: string) {
  const parsed = Date.parse(
    String(value || "")
  );
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString()
    : "—";
}

export default function SokoSellerApplicationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole =
    resolveSessionPlatformRole(session);
  const allowed =
    hasOfflineActivationRole(
      platformRole || "",
      "System_Admin"
    );

  const [filter, setFilter] =
    React.useState<Filter>("all");
  const [loading, setLoading] =
    React.useState(true);
  const [error, setError] =
    React.useState("");
  const [workingId, setWorkingId] =
    React.useState("");
  const [applications, setApplications] =
    React.useState<SokoSellerApplication[]>([]);

  const load = React.useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      setApplications(
        await fetchSokoSellerApplications(
          filter === "all" ? "" : filter
        )
      );
    } catch (nextError: any) {
      setError(
        String(
          nextError?.message ||
            "Could not load seller applications."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, filter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const review = React.useCallback(
    async (
      application: SokoSellerApplication,
      decision:
        | "approve"
        | "reject"
        | "revoke"
        | "regenerate_code"
    ) => {
      if (workingId) return;

      setWorkingId(application.id);
      setError("");

      try {
        const updated =
          await reviewSokoSellerApplication({
            applicationId:
              application.id,
            decision,
            notes:
              decision === "reject"
                ? "Application did not meet SOKO V1 seller requirements."
                : decision === "revoke"
                  ? "Seller access revoked by System Admin."
                  : "Approved directly by System Admin for SOKO V1.",
          });

        setApplications((current) =>
          current.map((row) =>
            row.id === updated.id
              ? updated
              : row
          )
        );

        Alert.alert(
          decision === "approve" ||
            decision === "regenerate_code"
            ? "Seller code ready"
            : "Application updated",
          updated.commandCode
            ? `${updated.displayName}'s code is ${updated.commandCode}. The applicant can also see it inside Kristo App.`
            : `${updated.displayName} is now ${updated.status}.`
        );
      } catch (nextError: any) {
        setError(
          String(
            nextError?.message ||
              "Could not review application."
          )
        );
      } finally {
        setWorkingId("");
      }
    },
    [workingId]
  );

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Ionicons
          name="lock-closed-outline"
          size={42}
          color={PINK}
        />
        <Text style={styles.emptyTitle}>
          System Admin only
        </Text>
        <Text style={styles.emptyText}>
          This seller approval workspace requires the System_Admin platform role.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#251743", "#10131D", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10 },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            SOKO Sellers
          </Text>
          <Text style={styles.headerSub}>
            Review applications • issue codes
          </Text>
        </View>

        <View style={styles.headerIcon}>
          <Ionicons
            name="storefront-outline"
            size={24}
            color={GOLD}
          />
        </View>
      </View>

      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {(
            [
              "all",
              "pending",
              "approved",
              "rejected",
              "revoked",
            ] as Filter[]
          ).map((item) => {
            const active = filter === item;
            return (
              <Pressable
                key={item}
                onPress={() => setFilter(item)}
                style={[
                  styles.filter,
                  active && styles.filterActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    active &&
                      styles.filterTextActive,
                  ]}
                >
                  {item.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={GOLD}
          />
          <Text style={styles.emptyText}>
            Loading applications…
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + 40,
            },
          ]}
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : null}

          {!applications.length ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name="file-tray-outline"
                size={37}
                color={MUTED}
              />
              <Text style={styles.emptyTitle}>
                No applications
              </Text>
              <Text style={styles.emptyText}>
                Seller applications will appear here after users apply from Kristo App.
              </Text>
            </View>
          ) : (
            applications.map((application) => {
              const working =
                workingId === application.id;

              return (
                <View
                  key={application.id}
                  style={styles.card}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {application.displayName
                          .slice(0, 2)
                          .toUpperCase()}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {application.displayName}
                      </Text>
                      <Text style={styles.kristoId}>
                        {application.kristoId}
                      </Text>
                    </View>

                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>
                        {application.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.details}>
                    <Text style={styles.business}>
                      {application.businessName}
                    </Text>
                    <Text style={styles.meta}>
                      {application.category} • {application.location}
                    </Text>
                    <Text style={styles.reason}>
                      {application.reason}
                    </Text>
                    <Text style={styles.date}>
                      Applied {formatDate(application.createdAt)}
                    </Text>
                  </View>

                  {application.commandCode ? (
                    <View style={styles.codeBox}>
                      <Text style={styles.codeLabel}>
                        ACTIVE COMMAND CODE
                      </Text>
                      <Text selectable style={styles.code}>
                        {application.commandCode}
                      </Text>
                      <Text style={styles.codeExpiry}>
                        Expires {formatDate(application.codeExpiresAt)}
                      </Text>
                    </View>
                  ) : null}

                  {working ? (
                    <ActivityIndicator
                      color={GOLD}
                      style={{ marginTop: 16 }}
                    />
                  ) : (
                    <View style={styles.actions}>
                      {application.status === "pending" ||
                      application.status === "rejected" ||
                      application.status === "revoked" ? (
                        <Pressable
                          onPress={() =>
                            void review(
                              application,
                              "approve"
                            )
                          }
                          style={[
                            styles.action,
                            styles.approve,
                          ]}
                        >
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={18}
                            color="#102016"
                          />
                          <Text style={styles.approveText}>
                            Approve & Issue Code
                          </Text>
                        </Pressable>
                      ) : null}

                      {application.status === "pending" ? (
                        <Pressable
                          onPress={() =>
                            void review(
                              application,
                              "reject"
                            )
                          }
                          style={styles.actionSecondary}
                        >
                          <Text style={styles.rejectText}>
                            Reject
                          </Text>
                        </Pressable>
                      ) : null}

                      {application.status === "approved" ? (
                        <>
                          <Pressable
                            onPress={() =>
                              void review(
                                application,
                                "regenerate_code"
                              )
                            }
                            style={styles.actionSecondary}
                          >
                            <Text style={styles.regenerateText}>
                              New Code
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              void review(
                                application,
                                "revoke"
                              )
                            }
                            style={styles.actionSecondary}
                          >
                            <Text style={styles.rejectText}>
                              Revoke
                            </Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 18, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 13 },
  back: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.11)" },
  headerTitle: { color: TEXT, fontSize: 27, fontWeight: "900" },
  headerSub: { color: MUTED, fontSize: 13, fontWeight: "700", marginTop: 2 },
  headerIcon: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,208,111,0.10)", borderWidth: 1, borderColor: "rgba(244,208,111,0.26)" },
  filterRow: { paddingHorizontal: 18, paddingBottom: 13 },
  filter: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  filterActive: { backgroundColor: "rgba(244,208,111,0.14)", borderColor: "rgba(244,208,111,0.34)" },
  filterText: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  filterTextActive: { color: GOLD },
  content: { padding: 18, gap: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 13, padding: 30, backgroundColor: BG },
  emptyCard: { padding: 30, borderRadius: 24, alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  emptyTitle: { color: TEXT, fontSize: 18, fontWeight: "900" },
  emptyText: { color: MUTED, fontSize: 13, lineHeight: 20, textAlign: "center" },
  errorCard: { padding: 14, borderRadius: 16, backgroundColor: "rgba(255,82,120,0.10)", borderWidth: 1, borderColor: "rgba(255,82,120,0.25)" },
  errorText: { color: PINK, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  card: { padding: 18, borderRadius: 23, backgroundColor: "rgba(19,23,34,0.94)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(185,162,255,0.13)" },
  avatarText: { color: PURPLE, fontSize: 15, fontWeight: "900" },
  name: { color: TEXT, fontSize: 17, fontWeight: "900" },
  kristoId: { color: PURPLE, fontSize: 12, fontWeight: "800", marginTop: 3 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(244,208,111,0.10)" },
  statusText: { color: GOLD, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  details: { marginTop: 16, paddingTop: 15, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)" },
  business: { color: TEXT, fontSize: 16, fontWeight: "900" },
  meta: { color: GREEN, fontSize: 12, fontWeight: "800", marginTop: 4 },
  reason: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 20, marginTop: 10 },
  date: { color: MUTED, fontSize: 11, marginTop: 9 },
  codeBox: { marginTop: 15, padding: 14, borderRadius: 16, backgroundColor: "rgba(244,208,111,0.07)", borderWidth: 1, borderColor: "rgba(244,208,111,0.22)" },
  codeLabel: { color: MUTED, fontSize: 9, letterSpacing: 1.1, fontWeight: "900" },
  code: { color: GOLD, fontSize: 21, letterSpacing: 1, fontWeight: "900", marginTop: 6 },
  codeExpiry: { color: MUTED, fontSize: 11, marginTop: 5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 16 },
  action: { minHeight: 45, paddingHorizontal: 14, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  approve: { backgroundColor: GREEN, flexGrow: 1 },
  approveText: { color: "#102016", fontSize: 12, fontWeight: "900" },
  actionSecondary: { minHeight: 45, paddingHorizontal: 15, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  rejectText: { color: PINK, fontSize: 12, fontWeight: "900" },
  regenerateText: { color: GOLD, fontSize: 12, fontWeight: "900" },
});
