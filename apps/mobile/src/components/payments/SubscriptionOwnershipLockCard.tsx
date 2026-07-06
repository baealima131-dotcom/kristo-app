import React, { useMemo } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import type { ChurchMediaSubscriptionOwnershipLock } from "../../lib/churchSubscriptionMediaSignals";
import { formatPremiumRenewalDate } from "../../lib/payments/mobileSubscriptions";

type Props = {
  lock: ChurchMediaSubscriptionOwnershipLock;
};

const GOLD = "#D9B35F";
const LABEL_GOLD = "rgba(217,179,95,0.82)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_MUTED = "rgba(255,255,255,0.62)";

function isInternalChurchIdLabel(value: string | null | undefined): boolean {
  return /^CH7-/i.test(String(value || "").trim());
}

function resolveChurchDisplayName(lock: ChurchMediaSubscriptionOwnershipLock): string | null {
  const name = String(lock.lockedChurchName || "").trim();
  if (!name || isInternalChurchIdLabel(name)) return null;
  return name;
}

function hasLinkedChurchDisplay(lock: ChurchMediaSubscriptionOwnershipLock): boolean {
  if (lock.hasLinkedChurchDisplay === true) return true;
  return Boolean(resolveChurchDisplayName(lock));
}

function resolveExpiryLabel(lock: ChurchMediaSubscriptionOwnershipLock): string | null {
  const label = String(lock.subscriptionExpiresAtLabel || lock.expiresAtLabel || "").trim();
  if (label) {
    return label.replace(/^(Sandbox )?expires /i, "").trim() || label;
  }
  const expiresAtMs = lock.subscriptionExpiresAt ?? lock.expiresAt;
  if (typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)) {
    return formatPremiumRenewalDate(new Date(expiresAtMs));
  }
  return null;
}

function resolveDeletedDateLabel(lock: ChurchMediaSubscriptionOwnershipLock): string | null {
  const label = String(lock.lockedChurchDeletedAtLabel || "").trim();
  if (label) return label;
  if (
    typeof lock.lockedChurchDeletedAt === "number" &&
    Number.isFinite(lock.lockedChurchDeletedAt)
  ) {
    return formatPremiumRenewalDate(new Date(lock.lockedChurchDeletedAt));
  }
  return null;
}

function resolveStoreAccountLabel(lock: ChurchMediaSubscriptionOwnershipLock): string {
  if (lock.store === "play_store") return "Google account";
  if (lock.store === "app_store") return "Apple ID";
  return Platform.OS === "android" ? "Google account" : "Apple ID";
}

function resolveRenewalGuidance(lock: ChurchMediaSubscriptionOwnershipLock): string {
  if (lock.willRenew === false) {
    return "This subscription is cancelled and will not renew. After it expires, you can subscribe this church.";
  }
  if (lock.willRenew === true) {
    return "Cancel renewal first. Access remains reserved until the current paid period ends.";
  }
  return "Manage your store subscription to review renewal before subscribing this church.";
}

function resolveFallbackCopy(lock: ChurchMediaSubscriptionOwnershipLock): string {
  return `A previous church subscription is still active on this ${resolveStoreAccountLabel(lock)}.`;
}

function ChurchAvatar({
  churchName,
  churchAvatarUrl,
}: {
  churchName: string;
  churchAvatarUrl: string | null;
}) {
  if (churchAvatarUrl) {
    return (
      <Image
        source={{ uri: churchAvatarUrl }}
        style={s.identityAvatar}
        resizeMode="cover"
        accessibilityLabel={`${churchName} church logo`}
      />
    );
  }

  return (
    <LinearGradient
      colors={["#F2D792", GOLD, "#9A7428"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.identityAvatarFallback}
    >
      <Ionicons name="business-outline" size={16} color="#0A0E16" />
    </LinearGradient>
  );
}

export function SubscriptionOwnershipLockCard({ lock }: Props) {
  const churchName = useMemo(() => resolveChurchDisplayName(lock), [lock]);
  const showIdentity = hasLinkedChurchDisplay(lock) && Boolean(churchName);
  const expiryLabel = useMemo(() => resolveExpiryLabel(lock), [lock]);
  const deletedDateLabel = useMemo(() => resolveDeletedDateLabel(lock), [lock]);
  const renewalGuidance = useMemo(() => resolveRenewalGuidance(lock), [lock]);
  const avatarUrl = String(lock.lockedChurchAvatarUrl || "").trim() || null;
  const churchStatusLabel = lock.lockedChurchDeleted ? "Deleted church" : "Previous church";

  return (
    <View style={s.card}>
      <LinearGradient
        pointerEvents="none"
        colors={["#0B1220", "#060A12", "#020408"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.08)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.50)", "rgba(217,179,95,0.10)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topGoldLine}
      />
      <View pointerEvents="none" style={s.ambientGlow} />

      <View style={s.content}>
        <View style={s.headerRow}>
          <View style={s.iconOuter}>
            <View style={s.iconGlow} pointerEvents="none" />
            <View style={s.iconRing} pointerEvents="none" />
            <LinearGradient
              colors={["#F2D792", GOLD, "#9A7428"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.iconTile}
            >
              <Ionicons name="link-outline" size={17} color="#0A0E16" />
            </LinearGradient>
          </View>

          <View style={s.headerCopy}>
            <Text style={s.eyebrow}>SUBSCRIPTION RESERVED</Text>
            <Text style={s.title}>Subscription linked to another church</Text>
          </View>
        </View>

        {showIdentity && churchName ? (
          <View style={s.identityBlock}>
            <View style={s.identityRow}>
              <ChurchAvatar churchName={churchName} churchAvatarUrl={avatarUrl} />
              <View style={s.identityCopy}>
                <Text style={s.identityName} numberOfLines={1}>
                  {churchName}
                </Text>
                <View style={s.statusPill}>
                  <View style={s.statusPillDot} />
                  <Text style={s.statusPillText}>{churchStatusLabel}</Text>
                </View>
              </View>
            </View>

            {lock.lockedChurchDeleted && deletedDateLabel ? (
              <Text style={s.metaLine}>Deleted on {deletedDateLabel}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={s.fallbackCopy}>{resolveFallbackCopy(lock)}</Text>
        )}

        <View style={s.divider} />

        {expiryLabel ? (
          <View style={s.expiryPill}>
            <Ionicons name="time-outline" size={12} color={LABEL_GOLD} />
            <Text style={s.expiryPillText}>Reserved until {expiryLabel}</Text>
          </View>
        ) : (
          <View style={s.expiryPill}>
            <Ionicons name="time-outline" size={12} color={LABEL_GOLD} />
            <Text style={s.expiryPillText}>Reserved until the current paid period ends</Text>
          </View>
        )}

        <Text style={s.guidanceCopy}>{renewalGuidance}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: "#060A12",
    overflow: "hidden",
    marginBottom: 14,
    shadowColor: GOLD,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  topGoldLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  ambientGlow: {
    position: "absolute",
    top: -20,
    right: -12,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.07)",
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 13,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  iconOuter: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  iconGlow: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  iconRing: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.42)",
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 3,
    paddingTop: 1,
  },
  eyebrow: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.1,
    lineHeight: 19,
  },
  identityBlock: {
    gap: 6,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(217,179,95,0.07)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  identityAvatar: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  identityAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  identityCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  identityName: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  statusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  statusPillDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  statusPillText: {
    color: "rgba(240,214,147,0.92)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  metaLine: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  fallbackCopy: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(217,179,95,0.16)",
  },
  expiryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  expiryPillText: {
    color: "rgba(240,214,147,0.94)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.15,
    flexShrink: 1,
  },
  guidanceCopy: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
});
