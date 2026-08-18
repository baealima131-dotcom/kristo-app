import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  fetchMySokoSellerApplication,
  submitMySokoSellerApplication,
  type SokoSellerApplication,
} from "@/src/lib/sokoSellerAccessApi";

const BG = "#080D13";
const CARD = "#121B21";
const TEXT = "#F8FAF7";
const MUTED = "rgba(248,250,247,0.62)";
const LIME = "#DDF25B";
const GREEN = "#5DEBA5";
const PINK = "#FF8CC8";

const CATEGORIES = [
  "Fashion",
  "Electronics",
  "Home",
  "Beauty",
  "Food",
  "Services",
  "Other",
];

function statusCopy(
  application: SokoSellerApplication
) {
  if (application.status === "approved") {
    return application.commandCode
      ? "Your seller command code is ready. Use it in SOKO with this same Kristo account."
      : "Your application is approved. If your previous code expired, ask System Admin to generate another code.";
  }

  if (application.status === "rejected") {
    return application.adminNotes ||
      "Your request was not approved. Update the information and submit again.";
  }

  if (application.status === "revoked") {
    return application.adminNotes ||
      "Your SOKO seller approval was revoked. You may submit a new application for review.";
  }

  return "System Admin is reviewing your request. Pastor permission is not required in V1.";
}

export default function SokoSellerApplicationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;

  const [loading, setLoading] =
    React.useState(true);
  const [saving, setSaving] =
    React.useState(false);
  const [error, setError] =
    React.useState("");
  const [application, setApplication] =
    React.useState<SokoSellerApplication | null>(null);
  const [businessName, setBusinessName] =
    React.useState("");
  const [category, setCategory] =
    React.useState("Fashion");
  const [location, setLocation] =
    React.useState("");
  const [reason, setReason] =
    React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result =
        await fetchMySokoSellerApplication();
      setApplication(result);

      if (result) {
        setBusinessName(result.businessName);
        setCategory(result.category);
        setLocation(result.location);
        setReason(result.reason);
      }
    } catch (nextError: any) {
      setError(
        String(
          nextError?.message ||
            "Could not load seller application."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const canSubmit =
    businessName.trim().length >= 2 &&
    category.trim().length > 0 &&
    location.trim().length >= 2 &&
    reason.trim().length >= 10;

  const submit = React.useCallback(async () => {
    if (!canSubmit || saving) return;

    setSaving(true);
    setError("");

    try {
      const result =
        await submitMySokoSellerApplication({
          businessName:
            businessName.trim(),
          category,
          location:
            location.trim(),
          reason:
            reason.trim(),
        });

      setApplication(result);
      Alert.alert(
        "Application submitted",
        "System Admin will review your request. Pastor approval is not required for SOKO V1."
      );
    } catch (nextError: any) {
      setError(
        String(
          nextError?.message ||
            "Could not submit seller application."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [
    businessName,
    canSubmit,
    category,
    location,
    reason,
    saving,
  ]);

  const locked =
    application?.status === "pending" ||
    application?.status === "approved";

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#173225", "#101622", BG]}
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
            Sell on SOKO
          </Text>
          <Text style={styles.headerSub}>
            Kristo verified seller access
          </Text>
        </View>

        <View style={styles.headerIcon}>
          <Ionicons
            name="storefront-outline"
            size={24}
            color={LIME}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={LIME}
          />
          <Text style={styles.centerText}>
            Loading seller access…
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
          <LinearGradient
            colors={["#173D31", "#101F1A"]}
            style={styles.identityCard}
          >
            <View style={styles.identityIcon}>
              <Ionicons
                name="shield-checkmark"
                size={27}
                color={LIME}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.identityLabel}>
                KRISTO IDENTITY
              </Text>
              <Text style={styles.identityName}>
                {String(
                  session?.displayName ||
                    session?.name ||
                    "Kristo Member"
                )}
              </Text>
              <Text style={styles.identityId}>
                {String(
                  session?.kristoId ||
                    "Kristo ID verified by server"
                ).toUpperCase()}
              </Text>
            </View>
          </LinearGradient>

          <View style={styles.v1Notice}>
            <Ionicons
              name="information-circle-outline"
              size={21}
              color="#93C5FD"
            />
            <Text style={styles.v1NoticeText}>
              SOKO V1 applications are reviewed directly by System Admin. No Pastor permission is required.
            </Text>
          </View>

          {application ? (
            <View
              style={[
                styles.statusCard,
                application.status === "approved" &&
                  styles.statusApproved,
              ]}
            >
              <View style={styles.statusTop}>
                <Text style={styles.statusEyebrow}>
                  APPLICATION STATUS
                </Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {application.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <Text style={styles.statusText}>
                {statusCopy(application)}
              </Text>

              {application.commandCode ? (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>
                    YOUR ONE-TIME COMMAND CODE
                  </Text>
                  <Text
                    selectable
                    style={styles.codeValue}
                  >
                    {application.commandCode}
                  </Text>
                  <Text style={styles.codeHelp}>
                    Enter this in SOKO while signed into the same Kristo account. It expires in 7 days and stops working after use.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {!locked ? (
            <>
              <Text style={styles.sectionLabel}>
                SELLER APPLICATION
              </Text>

              <View style={styles.formCard}>
                <Text style={styles.inputLabel}>
                  Business or shop name
                </Text>
                <TextInput
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="Example: Fariji Fashion"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>
                  Product category
                </Text>
                <View style={styles.categoryWrap}>
                  {CATEGORIES.map((item) => {
                    const active =
                      category === item;
                    return (
                      <Pressable
                        key={item}
                        onPress={() =>
                          setCategory(item)
                        }
                        style={[
                          styles.category,
                          active &&
                            styles.categoryActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryText,
                            active &&
                              styles.categoryTextActive,
                          ]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.inputLabel}>
                  Selling location
                </Text>
                <TextInput
                  value={location}
                  onChangeText={setLocation}
                  placeholder="City, country"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>
                  What will you sell?
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Describe your products and how you will serve buyers…"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  multiline
                  maxLength={1500}
                  style={[
                    styles.input,
                    styles.reasonInput,
                  ]}
                />
              </View>

              {error ? (
                <Text style={styles.error}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                disabled={!canSubmit || saving}
                onPress={submit}
                style={[
                  styles.submit,
                  (!canSubmit || saving) &&
                    styles.submitDisabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator
                    color="#132014"
                  />
                ) : (
                  <>
                    <Text style={styles.submitText}>
                      Submit to System Admin
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={19}
                      color="#132014"
                    />
                  </>
                )}
              </Pressable>
            </>
          ) : null}

          {error && locked ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={() => void load()}
            style={styles.refresh}
          >
            <Ionicons
              name="refresh-outline"
              size={18}
              color={GREEN}
            />
            <Text style={styles.refreshText}>
              Refresh application status
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  back: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  headerTitle: { color: TEXT, fontSize: 27, fontWeight: "900" },
  headerSub: { color: MUTED, fontSize: 13, fontWeight: "700", marginTop: 2 },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: "rgba(221,242,91,0.10)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(221,242,91,0.28)",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  centerText: { color: MUTED, fontSize: 14, fontWeight: "700" },
  content: { padding: 18, gap: 16 },
  identityCard: {
    borderRadius: 24,
    padding: 19,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(93,235,165,0.25)",
  },
  identityIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(221,242,91,0.10)",
  },
  identityLabel: { color: GREEN, fontSize: 10, letterSpacing: 1.4, fontWeight: "900" },
  identityName: { color: TEXT, fontSize: 18, fontWeight: "900", marginTop: 4 },
  identityId: { color: MUTED, fontSize: 13, fontWeight: "700", marginTop: 2 },
  v1Notice: {
    padding: 15,
    borderRadius: 18,
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(59,130,246,0.09)",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.20)",
  },
  v1NoticeText: { flex: 1, color: "rgba(219,234,254,0.78)", fontSize: 13, lineHeight: 20, fontWeight: "600" },
  statusCard: { padding: 19, borderRadius: 22, backgroundColor: CARD, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  statusApproved: { borderColor: "rgba(93,235,165,0.30)", backgroundColor: "rgba(20,54,43,0.82)" },
  statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusEyebrow: { color: MUTED, fontSize: 10, letterSpacing: 1.3, fontWeight: "900" },
  statusBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "rgba(221,242,91,0.12)" },
  statusBadgeText: { color: LIME, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  statusText: { color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 22, marginTop: 14, fontWeight: "600" },
  codeBox: { marginTop: 17, borderRadius: 18, padding: 16, backgroundColor: "rgba(0,0,0,0.24)", borderWidth: 1, borderColor: "rgba(221,242,91,0.30)" },
  codeLabel: { color: MUTED, fontSize: 9, letterSpacing: 1.2, fontWeight: "900" },
  codeValue: { color: LIME, fontSize: 25, fontWeight: "900", letterSpacing: 1.5, marginTop: 8 },
  codeHelp: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 9 },
  sectionLabel: { color: LIME, fontSize: 12, letterSpacing: 1.7, fontWeight: "900", marginTop: 5 },
  formCard: { borderRadius: 22, padding: 18, backgroundColor: CARD, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  inputLabel: { color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "800", marginBottom: 8, marginTop: 6 },
  input: { color: TEXT, minHeight: 51, borderRadius: 15, paddingHorizontal: 14, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", marginBottom: 14, fontSize: 14 },
  reasonInput: { minHeight: 115, paddingTop: 14, textAlignVertical: "top" },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  category: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  categoryActive: { backgroundColor: "rgba(221,242,91,0.13)", borderColor: "rgba(221,242,91,0.38)" },
  categoryText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  categoryTextActive: { color: LIME },
  error: { color: PINK, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  submit: { minHeight: 56, borderRadius: 18, backgroundColor: LIME, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  submitDisabled: { opacity: 0.38 },
  submitText: { color: "#132014", fontSize: 15, fontWeight: "900" },
  refresh: { minHeight: 48, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "rgba(93,235,165,0.18)" },
  refreshText: { color: GREEN, fontSize: 13, fontWeight: "800" },
});
