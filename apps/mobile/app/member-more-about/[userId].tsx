import { Ionicons } from "@expo/vector-icons";
import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const GOLD = "#F4D06F";
const BG = "#07111F";
const CARD = "rgba(255,255,255,0.055)";
const BORDER = "rgba(244,208,111,0.18)";
const MUTED = "rgba(255,255,255,0.58)";

type PublicMemberProfile = {
  userId?: string;
  fullName?: string;
  displayName?: string;
  name?: string;
  avatarUrl?: string;

  churchName?: string;
  role?: string;
  churchRole?: string;
  appRole?: string;

  country?: string;
  city?: string;
  gender?: string;
  age?: number | string;
  maritalStatus?: string;
  languages?: string[] | string;

  createdAt?: string | number;
  joinedAt?: string | number;
  memberSince?: string | number;

  profileFact?: string;
  bio?: string;

  churchesJoinedCount?: number;
  churchCount?: number;
  churchHistory?: Array<{
    churchName?: string;
    joinedAt?: string | number;
    leftAt?: string | number;
    exitType?: string;
    exitReasonPublic?: string;
  }>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function initials(value: string) {
  const parts = text(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return (
    parts.map((part) => part[0]?.toUpperCase())
      .join("") || "K"
  );
}

function formatDate(value: unknown) {
  if (!value) return "";

  const date = new Date(value as any);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(
    undefined,
    {
      month: "long",
      day: "numeric",
      year: "numeric",
    }
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<
    typeof Ionicons
  >["name"];
  label: string;
  value: string;
}) {
  if (!text(value)) return null;

  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons
          name={icon}
          size={18}
          color={GOLD}
        />
      </View>

      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>
          {label}
        </Text>

        <Text style={styles.infoValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export default function MoreAboutMemberScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    userId?: string;
    name?: string;
    avatarUrl?: string;
  }>();

  const userId = text(params.userId);
  const routeName =
    text(params.name) || "Member";
  const routeAvatar =
    text(params.avatarUrl);

  const [profile, setProfile] =
    useState<PublicMemberProfile | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!userId) {
        setError(
          "This member could not be identified."
        );
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const response: any =
          await apiGet(
            `/api/users/${encodeURIComponent(
              userId
            )}/profile`,
            {
              headers:
                getKristoHeaders(),
            },
            {
              screen:
                "MoreAboutMember",
              throttleMs: 0,
              dedupe: false,
            } as any
          );

        if (!alive) return;

        if (
          !response?.ok ||
          !response?.profile
        ) {
          setError(
            "Public member information is unavailable."
          );
          setProfile(null);
          return;
        }

        setProfile(
          response.profile
        );

        console.log(
          "KRISTO_MORE_ABOUT_HYDRATED",
          {
            targetUserId: userId,
            hasProfile: true,
          }
        );
      } catch (loadError: any) {
        if (!alive) return;

        setError(
          text(loadError?.message) ||
            "Could not load member information."
        );
        setProfile(null);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, [userId]);

  const name = text(
    profile?.fullName ||
      profile?.displayName ||
      profile?.name ||
      routeName
  );

  const avatarUrl = text(
    profile?.avatarUrl ||
      routeAvatar
  );

  const role = text(
    profile?.churchRole ||
      profile?.role ||
      profile?.appRole
  );

  const joinedDate = formatDate(
    profile?.memberSince ||
      profile?.joinedAt ||
      profile?.createdAt
  );

  const languages = useMemo(() => {
    const raw = profile?.languages;

    if (Array.isArray(raw)) {
      return raw
        .map(text)
        .filter(Boolean)
        .join(", ");
    }

    return text(raw);
  }, [profile?.languages]);

  const churchCount = Number(
    profile?.churchesJoinedCount ??
      profile?.churchCount ??
      profile?.churchHistory?.length ??
      0
  );

  const publicRows = [
    text(profile?.gender),
    text(profile?.age),
    text(profile?.maritalStatus),
    text(profile?.country),
    text(profile?.city),
    joinedDate,
    text(profile?.churchName),
    role,
    languages,
  ].filter(Boolean);

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 6,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={10}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color="#FFFFFF"
          />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>
            More About
          </Text>

          <Text
            style={styles.headerSubtitle}
            numberOfLines={1}
          >
            Public member information
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              insets.bottom + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.avatarShell}>
            {avatarUrl ? (
              <Image
                source={{
                  uri: avatarUrl,
                }}
                style={styles.avatar}
              />
            ) : (
              <Text style={styles.initials}>
                {initials(name)}
              </Text>
            )}
          </View>

          <Text
            style={styles.name}
            numberOfLines={2}
          >
            {name}
          </Text>

          {role ? (
            <View style={styles.rolePill}>
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={GOLD}
              />

              <Text style={styles.roleText}>
                {role}
              </Text>
            </View>
          ) : null}

          {text(
            profile?.profileFact ||
              profile?.bio
          ) ? (
            <Text style={styles.fact}>
              {
                text(
                  profile?.profileFact ||
                    profile?.bio
                )
              }
            </Text>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator
              color={GOLD}
              size="small"
            />

            <Text style={styles.stateText}>
              Loading public information…
            </Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Ionicons
              name="information-circle-outline"
              size={24}
              color={GOLD}
            />

            <Text style={styles.stateText}>
              {error}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Public information
              </Text>

              <View style={styles.card}>
                <InfoRow
                  icon="calendar-outline"
                  label="Kristo member since"
                  value={joinedDate}
                />

                <InfoRow
                  icon="business-outline"
                  label="Current church"
                  value={
                    text(
                      profile?.churchName
                    )
                  }
                />

                <InfoRow
                  icon="shield-outline"
                  label="Role"
                  value={role}
                />

                <InfoRow
                  icon="male-female-outline"
                  label="Gender"
                  value={
                    text(profile?.gender)
                  }
                />

                <InfoRow
                  icon="hourglass-outline"
                  label="Age"
                  value={
                    text(profile?.age)
                  }
                />

                <InfoRow
                  icon="heart-outline"
                  label="Marital status"
                  value={
                    text(
                      profile?.maritalStatus
                    )
                  }
                />

                <InfoRow
                  icon="earth-outline"
                  label="Country"
                  value={
                    text(profile?.country)
                  }
                />

                <InfoRow
                  icon="location-outline"
                  label="City"
                  value={
                    text(profile?.city)
                  }
                />

                <InfoRow
                  icon="language-outline"
                  label="Languages"
                  value={languages}
                />

                {publicRows.length === 0 ? (
                  <View
                    style={styles.emptyPublicInfo}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={22}
                      color={MUTED}
                    />

                    <Text
                      style={styles.emptyPublicText}
                    >
                      This member has not shared additional public information.
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Church journey
              </Text>

              <View style={styles.card}>
                <InfoRow
                  icon="trail-sign-outline"
                  label="Churches joined"
                  value={
                    churchCount > 0
                      ? String(churchCount)
                      : ""
                  }
                />

                {
                  Array.isArray(
                    profile?.churchHistory
                  ) &&
                  profile.churchHistory.length >
                    0
                    ? profile.churchHistory.map(
                        (item, index) => {
                          const churchName =
                            text(
                              item?.churchName
                            ) ||
                            `Church ${
                              index + 1
                            }`;

                          const joined =
                            formatDate(
                              item?.joinedAt
                            );

                          const left =
                            formatDate(
                              item?.leftAt
                            );

                          const exit =
                            text(
                              item?.exitReasonPublic ||
                                item?.exitType
                            );

                          const detail = [
                            joined
                              ? `Joined ${joined}`
                              : "",
                            left
                              ? `Left ${left}`
                              : "",
                            exit,
                          ]
                            .filter(Boolean)
                            .join(" • ");

                          return (
                            <View
                              key={
                                `${
                                  churchName
                                }-${index}`
                              }
                              style={styles.historyItem}
                            >
                              <View
                                style={styles.historyDot}
                              />

                              <View
                                style={styles.historyText}
                              >
                                <Text
                                  style={styles.historyName}
                                >
                                  {churchName}
                                </Text>

                                {detail ? (
                                  <Text
                                    style={styles.historyDetail}
                                  >
                                    {detail}
                                  </Text>
                                ) : null}
                              </View>
                            </View>
                          );
                        }
                      )
                    : (
                      <View
                        style={styles.emptyPublicInfo}
                      >
                        <Ionicons
                          name="lock-closed-outline"
                          size={22}
                          color={MUTED}
                        />

                        <Text
                          style={styles.emptyPublicText}
                        >
                          Church history is not publicly shared.
                        </Text>
                      </View>
                    )
                }
              </View>
            </View>

            <View style={styles.privacyNote}>
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={GOLD}
              />

              <Text style={styles.privacyText}>
                Only information released by this member’s public profile is shown here.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(255,255,255,0.07)",
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.06)",
  },

  headerText: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 10,
  },

  headerTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },

  headerSubtitle: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },

  headerSpacer: {
    width: 42,
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },

  heroCard: {
    alignItems: "center",
    padding: 22,
    borderRadius: 26,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.24)",
    backgroundColor:
      "rgba(244,208,111,0.055)",
  },

  avatarShell: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor:
      "rgba(244,208,111,0.72)",
    backgroundColor:
      "rgba(244,208,111,0.10)",
  },

  avatar: {
    width: "100%",
    height: "100%",
  },

  initials: {
    color: GOLD,
    fontSize: 31,
    fontWeight: "900",
  },

  name: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 14,
  },

  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 9,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor:
      "rgba(244,208,111,0.10)",
  },

  roleText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
  },

  fact: {
    color:
      "rgba(255,255,255,0.70)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 13,
  },

  section: {
    marginTop: 22,
  },

  sectionTitle: {
    color:
      "rgba(255,255,255,0.68)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 9,
    marginLeft: 3,
  },

  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    overflow: "hidden",
  },

  infoRow: {
    minHeight: 67,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderBottomWidth:
      StyleSheet.hairlineWidth,
    borderBottomColor:
      "rgba(255,255,255,0.08)",
  },

  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.09)",
  },

  infoText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },

  infoLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.55,
  },

  infoValue: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    marginTop: 3,
  },

  stateCard: {
    minHeight: 110,
    marginTop: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 10,
  },

  stateText: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
  },

  emptyPublicInfo: {
    minHeight: 105,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 9,
  },

  emptyPublicText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },

  historyItem: {
    flexDirection: "row",
    paddingHorizontal: 17,
    paddingVertical: 15,
    borderBottomWidth:
      StyleSheet.hairlineWidth,
    borderBottomColor:
      "rgba(255,255,255,0.08)",
  },

  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: GOLD,
  },

  historyText: {
    flex: 1,
    marginLeft: 12,
  },

  historyName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  historyDetail: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 4,
  },

  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 18,
    paddingHorizontal: 5,
  },

  privacyText: {
    flex: 1,
    color:
      "rgba(255,255,255,0.48)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
});
