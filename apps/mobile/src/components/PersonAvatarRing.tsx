import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

/**
 * Who a person is relative to the viewer, from verified church data only (active memberships
 * and their church role, as the server reports them). Anything not verified is "unknown" and
 * gets the neutral ring: the app never guesses a role.
 */
export type PersonRingCategory =
  | "myChurchPastor"
  | "myChurchMember"
  | "otherChurchPastor"
  | "otherChurchMember"
  | "unknown";

const PERSON_RING_CATEGORIES = new Set<PersonRingCategory>([
  "myChurchPastor",
  "myChurchMember",
  "otherChurchPastor",
  "otherChurchMember",
]);

/** A category from the server, or "unknown" for anything else (older server, bad value). */
export function normalizePersonRingCategory(value: unknown): PersonRingCategory {
  return PERSON_RING_CATEGORIES.has(value as PersonRingCategory)
    ? (value as PersonRingCategory)
    : "unknown";
}

function isPastorRole(role: string) {
  return role.trim().toLowerCase() === "pastor";
}

/**
 * - `viewerChurchId`: the viewer's active church ("" when unknown).
 * - `personChurchId`: the person's active church ("" when unknown or not a member).
 * - `personRole`: the person's church role in that church ("" when unknown).
 * - `sharesActiveChurch`: optional server verdict that both are active members of one church;
 *   when given it wins over comparing ids.
 */
export function resolvePersonRingCategory(input: {
  viewerChurchId?: string | null;
  personChurchId?: string | null;
  personRole?: string | null;
  sharesActiveChurch?: boolean | null;
}): PersonRingCategory {
  const personChurchId = String(input.personChurchId || "").trim();
  const role = String(input.personRole || "").trim();
  if (!personChurchId || !role) return "unknown";
  const viewerChurchId = String(input.viewerChurchId || "").trim();
  const sameChurch =
    typeof input.sharesActiveChurch === "boolean"
      ? input.sharesActiveChurch
      : viewerChurchId
        ? viewerChurchId === personChurchId
        : null;
  if (sameChurch === null) return "unknown";
  if (sameChurch) return isPastorRole(role) ? "myChurchPastor" : "myChurchMember";
  return isPastorRole(role) ? "otherChurchPastor" : "otherChurchMember";
}

/** Short spoken description, for accessibility labels next to a person's name. */
export function describePersonRingCategory(category: PersonRingCategory): string {
  switch (category) {
    case "myChurchPastor":
      return "Pastor of your church";
    case "myChurchMember":
      return "Member of your church";
    case "otherChurchPastor":
      return "Pastor of another church";
    case "otherChurchMember":
      return "Member of another church";
    default:
      return "";
  }
}

const RING: Record<
  PersonRingCategory,
  { color: string; width: number; glow?: string; badge?: string }
> = {
  // Your church: Kristo gold. Your pastor gets the thick gold ring, glow and cross badge.
  myChurchPastor: { color: "#F4D06F", width: 3, glow: "rgba(244,208,111,0.55)", badge: "#C9A227" },
  myChurchMember: { color: "rgba(244,208,111,0.85)", width: 2 },
  // Another church: Kristo purple. Their pastor gets the thick purple ring, glow and badge.
  otherChurchPastor: { color: "#B57BFF", width: 3, glow: "rgba(181,123,255,0.5)", badge: "#7C3AED" },
  otherChurchMember: { color: "rgba(181,123,255,0.8)", width: 2 },
  unknown: { color: "rgba(255,255,255,0.16)", width: StyleSheet.hairlineWidth },
};

/**
 * Wraps a round avatar (image or initial) of diameter `size` with the category ring. The ring
 * sits outside the avatar, so the avatar keeps its size and layout.
 *
 * `glow="subtle"` swaps the pastor shadow (and its Android elevation, which draws an offset,
 * polygonal shadow through translucent avatars) for a faint concentric halo.
 */
export function PersonAvatarRing({
  category,
  size,
  children,
  style,
  glow = "default",
}: {
  category: PersonRingCategory;
  size: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  glow?: "default" | "subtle";
}) {
  const ring = RING[category];
  const gap = category === "unknown" ? 0 : 2;
  const outer = size + 2 * (ring.width + gap);
  const badgeSize = Math.max(14, Math.round(size * 0.34));
  return (
    <View
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: ring.width,
          borderColor: ring.color,
          margin: -(ring.width + gap),
        },
        ring.glow && glow === "default"
          ? { shadowColor: ring.glow, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 4 }
          : null,
        style,
      ]}
    >
      {ring.glow && glow === "subtle" ? (
        <View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              top: -(ring.width + HALO_WIDTH),
              left: -(ring.width + HALO_WIDTH),
              width: outer + 2 * HALO_WIDTH,
              height: outer + 2 * HALO_WIDTH,
              borderRadius: outer / 2 + HALO_WIDTH,
              borderColor: ring.glow,
            },
          ]}
        />
      ) : null}
      {children}
      {ring.badge ? (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: ring.badge,
              borderColor: ring.color,
            },
          ]}
          pointerEvents="none"
        >
          <MaterialCommunityIcons name="cross" size={Math.round(badgeSize * 0.62)} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const HALO_WIDTH = 2;

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    borderWidth: HALO_WIDTH,
    opacity: 0.35,
  },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
