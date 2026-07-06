import React, { useMemo } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
    return "This subscription is cancelled and will not renew. After the reserved period ends, you can subscribe this church.";
  }
  if (lock.willRenew === true) {
    return "Cancel renewal in Apple or Google Play first. Access stays reserved until the paid period ends.";
  }
  return `Your store subscription on this ${resolveStoreAccountLabel(lock)} is still reserved for another church until the paid period ends.`;
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
        style={s.avatar}
        resizeMode="cover"
        accessibilityLabel={`${churchName} church logo`}
      />
    );
  }

  return (
    <View style={s.avatarFallback}>
      <Ionicons name="business-outline" size={13} color={LABEL_GOLD} />
    </View>
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
      <View style={s.content}>
        <View style={s.topHeader}>
          <View style={s.iconBadge}>
            <Ionicons name="lock-closed-outline" size={13} color={GOLD} />
          </View>
          <Text style={s.eyebrow}>SUBSCRIPTION RESERVED</Text>
        </View>

        <Text style={s.title}>Premium is reserved for another church</Text>

        {showIdentity && churchName ? (
          <View style={s.churchRow}>
            <ChurchAvatar churchName={churchName} churchAvatarUrl={avatarUrl} />
            <View style={s.churchCopy}>
              <Text style={s.linkedChurchLabel} numberOfLines={2}>
                Linked church: <Text style={s.linkedChurchName}>{churchName}</Text>
              </Text>
              <View style={s.statusPill}>
                <Text style={s.statusPillText}>{churchStatusLabel}</Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={s.fallbackCopy}>{resolveFallbackCopy(lock)}</Text>
        )}

        {showIdentity && lock.lockedChurchDeleted && deletedDateLabel ? (
          <Text style={s.deletedLine}>Deleted on {deletedDateLabel}</Text>
        ) : null}

        <View style={s.expiryPill}>
          <Text style={s.expiryPillText}>
            {expiryLabel
              ? `Reserved until ${expiryLabel}`
              : "Reserved until the paid period ends"}
          </Text>
        </View>

        <Text style={s.guidanceCopy}>{renewalGuidance}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(8,12,20,0.92)",
    marginBottom: 12,
  },
  content: {
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  eyebrow: {
    color: LABEL_GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.05,
    lineHeight: 20,
  },
  churchRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 1,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    marginTop: 1,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    marginTop: 1,
  },
  churchCopy: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  linkedChurchLabel: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 17,
  },
  linkedChurchName: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  statusPillText: {
    color: "rgba(240,214,147,0.92)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  deletedLine: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
    marginTop: -2,
  },
  fallbackCopy: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  expiryPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  expiryPillText: {
    color: "rgba(240,214,147,0.94)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  guidanceCopy: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
});
