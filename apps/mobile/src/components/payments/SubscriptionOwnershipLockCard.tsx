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
const GOLD_BRIGHT = "#F0D48A";
const LABEL_GOLD = "rgba(217,179,95,0.88)";
const TEXT_PRIMARY = "rgba(255,255,255,0.97)";
const TEXT_MUTED = "rgba(255,255,255,0.68)";

const BODY_COPY =
  "This subscription remains linked to your previous church until the paid period ends.";

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

function resolveFallbackCopy(lock: ChurchMediaSubscriptionOwnershipLock): string {
  return `A previous church subscription is still active on this ${resolveStoreAccountLabel(lock)}. ${BODY_COPY}`;
}

function PowerCardChrome() {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={["#0B1220", "#060A12", "#020408"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.10)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.42 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={s.ambientGlowTop} />
      <View pointerEvents="none" style={s.ambientGlowBottom} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.62)", "rgba(217,179,95,0.14)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topGoldLine}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.02)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
        style={s.powerSheen}
      />
    </>
  );
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
        style={s.avatar}
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
      style={s.avatarFallback}
    >
      <Ionicons name="business-outline" size={20} color="#0A0E16" />
    </LinearGradient>
  );
}

export function SubscriptionOwnershipLockCard({ lock }: Props) {
  const churchName = useMemo(() => resolveChurchDisplayName(lock), [lock]);
  const showIdentity = hasLinkedChurchDisplay(lock) && Boolean(churchName);
  const expiryLabel = useMemo(() => resolveExpiryLabel(lock), [lock]);
  const deletedDateLabel = useMemo(() => resolveDeletedDateLabel(lock), [lock]);
  const avatarUrl = String(lock.lockedChurchAvatarUrl || "").trim() || null;
  const churchStatusLabel = lock.lockedChurchDeleted ? "Deleted church" : "Previous church";

  return (
    <View style={s.card}>
      <PowerCardChrome />

      <View style={s.content}>
        <View style={s.heroBlock}>
          <View style={s.iconOuter}>
            <View style={s.iconGlow} pointerEvents="none" />
            <View style={s.iconRing} pointerEvents="none" />
            <LinearGradient
              colors={["#F2D792", GOLD, "#9A7428"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.iconTile}
            >
              <Ionicons name="link-outline" size={22} color="#0A0E16" />
            </LinearGradient>
          </View>

          <Text style={s.eyebrow}>SUBSCRIPTION RESERVED</Text>
          <Text style={s.title}>Premium reserved for another church</Text>
        </View>

        {showIdentity && churchName ? (
          <View style={s.identityStrip}>
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(217,179,95,0.09)", "rgba(217,179,95,0.03)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <ChurchAvatar churchName={churchName} churchAvatarUrl={avatarUrl} />
            <View style={s.identityCopy}>
              <Text style={s.churchName} numberOfLines={2}>
                {churchName}
              </Text>
              {lock.lockedChurchDeleted && deletedDateLabel ? (
                <Text style={s.deletedLine}>Deleted on {deletedDateLabel}</Text>
              ) : null}
            </View>
            <View style={s.statusBadge}>
              <View style={s.statusBadgeDot} />
              <Text style={s.statusBadgeText}>{churchStatusLabel}</Text>
            </View>
          </View>
        ) : (
          <Text style={s.fallbackCopy}>{resolveFallbackCopy(lock)}</Text>
        )}

        <View style={s.expiryPill}>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(217,179,95,0.16)", "rgba(217,179,95,0.06)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Ionicons name="shield-checkmark-outline" size={14} color={GOLD_BRIGHT} />
          <Text style={s.expiryPillText}>
            {expiryLabel ? `Reserved until ${expiryLabel}` : "Reserved until the paid period ends"}
          </Text>
        </View>

        <Text style={s.bodyCopy}>{BODY_COPY}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.40)",
    backgroundColor: "#060A12",
    overflow: "hidden",
    marginBottom: 16,
    shadowColor: GOLD,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  ambientGlowTop: {
    position: "absolute",
    top: -24,
    right: -14,
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.09)",
  },
  ambientGlowBottom: {
    position: "absolute",
    bottom: -28,
    left: -16,
    width: 84,
    height: 84,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  topGoldLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  powerSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 40,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    gap: 14,
  },
  heroBlock: {
    alignItems: "center",
    gap: 8,
  },
  iconOuter: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  iconGlow: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(217,179,95,0.18)",
  },
  iconRing: {
    position: "absolute",
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.50)",
  },
  iconTile: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.1,
    lineHeight: 24,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  identityStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.40)",
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.40)",
  },
  identityCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  churchName: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  deletedLine: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  statusBadgeText: {
    color: GOLD_BRIGHT,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  fallbackCopy: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  expiryPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
  },
  expiryPillText: {
    color: GOLD_BRIGHT,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.15,
    flexShrink: 1,
    textAlign: "center",
  },
  bodyCopy: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 6,
  },
});
