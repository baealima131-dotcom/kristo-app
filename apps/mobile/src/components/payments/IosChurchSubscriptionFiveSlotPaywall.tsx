import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { PurchasesStoreProduct } from "react-native-purchases";
import {
  formatStoreProductDisplayPrice,
  resolveIntroTrialDays,
  resolveStoreProductIntro,
  storeProductHasIntroOffer,
  isIntroOfferFreeTrial,
} from "../../lib/payments/mobileSubscriptions";
import { PREMIUM_MONTHLY_PRODUCT_ID } from "../../lib/payments/churchPremiumRevenueCat";
import {
  resolveIosPremiumSlotOwnershipDisplay,
  type IosPremiumSlotStatusCode,
} from "../../lib/payments/iosPremiumSlotStatus";

export type IosChurchSubscriptionSlotCardModel = {
  productId: string;
  slotLabel: string;
  subscriptionGroupName: string;
  status: IosPremiumSlotStatusCode;
  statusLabel: string;
  purchaseEnabled: boolean;
  storeProduct: PurchasesStoreProduct | null;
  /** Backend-mapped Church ID for this product only (never invent from currentChurchId). */
  mappedChurchId: string | null;
  /** False when purchase-product inspect failed — ownership must stay unknown. */
  ownershipInspectionOk: boolean;
};

function statusTone(status: string): {
  border: string;
  bg: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case "available":
      return {
        border: "rgba(120,220,160,0.45)",
        bg: "rgba(40,120,80,0.22)",
        text: "rgba(170,240,200,0.98)",
        dot: "rgba(120,230,170,0.95)",
      };
    case "available_for_another_church":
      return {
        border: "rgba(120,190,240,0.42)",
        bg: "rgba(30,80,130,0.24)",
        text: "rgba(180,220,255,0.96)",
        dot: "rgba(130,200,255,0.95)",
      };
    case "purchased_for_this_church":
      return {
        border: "rgba(232,208,150,0.45)",
        bg: "rgba(120,90,30,0.24)",
        text: "rgba(242,220,160,0.98)",
        dot: "rgba(240,210,130,0.95)",
      };
    case "used_by_another_church":
      return {
        border: "rgba(255,150,140,0.4)",
        bg: "rgba(120,40,40,0.22)",
        text: "rgba(255,190,180,0.96)",
        dot: "rgba(255,150,140,0.95)",
      };
    default:
      return {
        border: "rgba(160,170,190,0.35)",
        bg: "rgba(40,48,64,0.35)",
        text: "rgba(200,210,230,0.9)",
        dot: "rgba(170,180,200,0.9)",
      };
  }
}

function IosChurchSubscriptionSlotCard({
  churchId,
  slot,
  loading,
  disabledNote,
  onPurchase,
}: {
  churchId: string;
  slot: IosChurchSubscriptionSlotCardModel;
  loading?: boolean;
  disabledNote?: string;
  onPurchase: (productId: string) => void;
}) {
  const tone = statusTone(String(slot.status || ""));
  const ownership = resolveIosPremiumSlotOwnershipDisplay({
    status: slot.status,
    currentChurchId: churchId,
    mappedChurchId: slot.mappedChurchId,
    ownershipInspectionOk: slot.ownershipInspectionOk,
  });
  const displayPrice =
    formatStoreProductDisplayPrice(slot.storeProduct) || "Price unavailable";
  const intro = resolveStoreProductIntro(slot.storeProduct);
  const showTrial =
    Boolean(slot.storeProduct) &&
    storeProductHasIntroOffer(slot.storeProduct) &&
    isIntroOfferFreeTrial(intro) &&
    slot.productId === PREMIUM_MONTHLY_PRODUCT_ID;
  const trialDays = resolveIntroTrialDays(intro) ?? 14;
  const ctaLabel = showTrial
    ? `Start ${trialDays}-Day Free Trial`
    : "Subscribe Monthly";

  return (
    <View style={styles.outer}>
      <View style={styles.shell}>
        <LinearGradient
          colors={[
            "rgba(28,42,72,0.92)",
            "rgba(16,22,38,0.96)",
            "rgba(10,12,22,0.98)",
            "rgba(8,10,18,0.99)",
          ]}
          locations={[0, 0.32, 0.7, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.card}
        >
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(232,208,150,0.14)", "transparent", "transparent"]}
            locations={[0, 0.22, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.atmosphereTop}
          />
          <View pointerEvents="none" style={styles.innerBorder} />
          <View pointerEvents="none" style={styles.goldEdge} />

          <View style={styles.statusRow}>
            <View style={styles.eyebrowPill}>
              <View style={styles.statusDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow} maxFontSizeMultiplier={1.15}>
                  CHURCH SUBSCRIPTION · {slot.slotLabel}
                </Text>
                <Text style={styles.eyebrowSub} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {slot.subscriptionGroupName}
                </Text>
              </View>
            </View>
            {showTrial ? (
              <View style={styles.trialPill}>
                <Text style={styles.trialPillText} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {trialDays}-DAY FREE TRIAL
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.topRow}>
            <View style={styles.left}>
              <View style={styles.iconTile}>
                <LinearGradient
                  colors={["rgba(250,230,180,0.38)", "rgba(180,140,60,0.16)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.iconTileFill}
                >
                  <Ionicons name="calendar-outline" size={18} color="rgba(250,230,180,1)" />
                </LinearGradient>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  Monthly Plan
                </Text>
                <Text style={styles.subtitle} numberOfLines={2} maxFontSizeMultiplier={1.25}>
                  {slot.productId}
                </Text>
              </View>
            </View>

            <View style={styles.priceTile}>
              <LinearGradient
                colors={["rgba(255,255,255,0.1)", "rgba(20,24,36,0.55)"]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.priceTileFill}
              >
                {showTrial ? (
                  <>
                    <Text style={styles.trialPrice} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {trialDays}-Day Free Trial
                    </Text>
                    <Text style={styles.trialThen} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      Then {displayPrice}
                    </Text>
                    <Text style={styles.period} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      per month
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.price} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {displayPrice}
                    </Text>
                    <Text style={styles.period} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      per month
                    </Text>
                  </>
                )}
              </LinearGradient>
            </View>
          </View>

          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>{ownership.label}</Text>
            <Text style={styles.metaValue} selectable>
              {ownership.value}
            </Text>
            {ownership.note ? (
              <Text style={styles.metaNote}>{ownership.note}</Text>
            ) : null}
            <View style={[styles.statusChip, { borderColor: tone.border, backgroundColor: tone.bg }]}>
              <View style={[styles.statusChipDot, { backgroundColor: tone.dot }]} />
              <Text style={[styles.statusChipText, { color: tone.text }]} numberOfLines={2}>
                {slot.statusLabel}
              </Text>
            </View>
          </View>

          {slot.purchaseEnabled ? (
            <Pressable
              onPress={() => onPurchase(slot.productId)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={`${ctaLabel} for ${slot.slotLabel}`}
              accessibilityState={{ disabled: !!loading, busy: !!loading }}
              style={({ pressed }) => [
                styles.ctaOuter,
                pressed ? styles.ctaPressed : null,
                loading ? styles.ctaDisabled : null,
              ]}
            >
              <LinearGradient
                colors={["#F6E6C0", "#E0C07A", "#C4A05A", "#B08A48"]}
                locations={[0, 0.35, 0.75, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ctaGradient}
              >
                {loading ? (
                  <ActivityIndicator color="#1A1610" size="small" />
                ) : (
                  <View style={styles.ctaContent}>
                    <Text style={styles.ctaText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                      {ctaLabel}
                    </Text>
                    <Ionicons name="arrow-forward" size={16} color="#1A1610" />
                  </View>
                )}
              </LinearGradient>
            </Pressable>
          ) : (
            <View style={styles.disabledNote}>
              <Ionicons name="lock-closed-outline" size={14} color="rgba(255,255,255,0.55)" />
              <Text style={styles.disabledNoteText}>
                {disabledNote || "premium_monthly is unavailable from Apple right now"}
              </Text>
            </View>
          )}
        </LinearGradient>
      </View>
    </View>
  );
}

export function IosChurchSubscriptionFiveSlotPaywall({
  churchId,
  slots,
  submittingProductId,
  allSlotsOccupied,
  canPurchase = true,
  /**
   * "purchase" = unsubscribed church may buy an available slot.
   * "catalog" = church already subscribed; premium_monthly is reference-only.
   */
  mode = "purchase",
  onPurchase,
  onRestore,
  restoring,
}: {
  churchId: string;
  slots: IosChurchSubscriptionSlotCardModel[];
  submittingProductId?: string | null;
  allSlotsOccupied?: boolean;
  canPurchase?: boolean;
  mode?: "purchase" | "catalog";
  onPurchase: (productId: string) => void;
  onRestore?: () => void;
  restoring?: boolean;
}) {
  const catalogOnly = mode === "catalog";

  return (
    <View style={styles.list}>
      {catalogOnly ? (
        <>
          <Text style={styles.sectionTitle}>Monthly Subscription Options</Text>
          <Text style={styles.explain}>
            Church ID {churchId || "—"} already has an active subscription. premium_monthly
            is the only product offered for new iOS purchases. Legacy G2–G5 subscriptions
            remain supported for existing owners and restore, but are not sold here.
          </Text>
        </>
      ) : (
        <Text style={styles.explain}>
          Subscribe Church ID {churchId || "—"} with premium_monthly. Each subscription
          lineage is permanently assigned to one church.
        </Text>
      )}

      {!catalogOnly && !canPurchase ? (
        <View style={styles.exhaustedCard}>
          <Ionicons name="lock-closed-outline" size={18} color="rgba(255,190,160,0.95)" />
          <Text style={styles.exhaustedText}>
            Only the Pastor who created or manages this church can purchase Church
            Subscription. Ordinary members and ministries do not receive separate
            subscriptions.
          </Text>
        </View>
      ) : null}

      {!catalogOnly && canPurchase && allSlotsOccupied ? (
        <View style={styles.exhaustedCard}>
          <Ionicons name="alert-circle-outline" size={18} color="rgba(255,190,160,0.95)" />
          <Text style={styles.exhaustedText}>
            premium_monthly is already owned or assigned in this Apple purchase context.
            Restore it for its mapped Church ID or manage the existing subscription.
          </Text>
        </View>
      ) : null}

      {slots.map((slot) => (
        <IosChurchSubscriptionSlotCard
          key={slot.productId}
          churchId={churchId}
          slot={{
            ...slot,
            purchaseEnabled: catalogOnly ? false : canPurchase ? slot.purchaseEnabled : false,
          }}
          loading={submittingProductId === slot.productId}
          disabledNote={
            catalogOnly
              ? slot.status === "purchased_for_this_church"
                ? "Active subscription for this Church ID"
                : slot.status === "available_for_another_church"
                  ? "Switch to or create an unsubscribed church to use this slot."
                  : undefined
              : undefined
          }
          onPurchase={onPurchase}
        />
      ))}

      {!catalogOnly && canPurchase && onRestore ? (
        <Pressable
          onPress={onRestore}
          disabled={restoring || Boolean(submittingProductId)}
          style={({ pressed }) => [
            styles.restoreBtn,
            pressed ? { opacity: 0.88 } : null,
            restoring ? { opacity: 0.6 } : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Restore Purchases"
        >
          {restoring ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.restoreBtnText}>Restore Purchases</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 14,
  },
  sectionTitle: {
    marginTop: 6,
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.25,
  },
  explain: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginBottom: 4,
  },
  exhaustedCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(120,40,30,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,150,120,0.35)",
  },
  exhaustedText: {
    flex: 1,
    color: "rgba(255,210,190,0.96)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  outer: {
    position: "relative",
  },
  shell: {
    borderRadius: 24,
    overflow: "hidden",
  },
  card: {
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(214,180,110,0.28)",
    overflow: "hidden",
  },
  atmosphereTop: {
    ...StyleSheet.absoluteFillObject,
  },
  innerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  goldEdge: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: "rgba(232,208,150,0.35)",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  eyebrowPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: "rgba(232,208,150,0.95)",
  },
  eyebrow: {
    color: "rgba(232,208,150,0.95)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  eyebrowSub: {
    marginTop: 1,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
  },
  trialPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(60,140,100,0.28)",
    borderWidth: 1,
    borderColor: "rgba(120,220,160,0.4)",
  },
  trialPillText: {
    color: "rgba(170,240,200,0.98)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    overflow: "hidden",
  },
  iconTileFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 2,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
  },
  priceTile: {
    minWidth: 112,
    borderRadius: 14,
    overflow: "hidden",
  },
  priceTileFill: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: "flex-end",
  },
  price: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  trialPrice: {
    color: "rgba(170,240,200,0.98)",
    fontSize: 12,
    fontWeight: "900",
  },
  trialThen: {
    marginTop: 2,
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  period: {
    marginTop: 2,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "700",
  },
  metaBlock: {
    marginTop: 14,
    gap: 6,
  },
  metaLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  metaValue: {
    color: "rgba(232,208,150,0.95)",
    fontSize: 14,
    fontWeight: "900",
  },
  metaNote: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  statusChip: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%",
  },
  statusChipDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  statusChipText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "800",
  },
  ctaOuter: {
    marginTop: 14,
    borderRadius: 999,
    overflow: "hidden",
  },
  ctaPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  ctaDisabled: {
    opacity: 0.65,
  },
  ctaGradient: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  ctaContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ctaText: {
    color: "#1A1610",
    fontSize: 14,
    fontWeight: "900",
  },
  disabledNote: {
    marginTop: 14,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  disabledNoteText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  restoreBtn: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  restoreBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
});
