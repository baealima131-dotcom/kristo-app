import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  type ImageSourcePropType,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import {
  activityCardBackgroundUri,
  activityHasVisualMedia,
  activityIsVideo,
  churchActivityBody,
  churchActivityIcon,
  churchActivityTitle,
  getActivityGridLabel,
  type ActivityGridItem,
  type ChurchActivityLabel,
} from "@/src/lib/churchActivityPosts";

const GRID_GAP = 10;
const CARD_ASPECT = 9 / 14;

function labelEyebrow(label: ChurchActivityLabel) {
  switch (label) {
    case "TESTIMONY":
      return "Faith story";
    case "ANNOUNCEMENT":
      return "Church update";
    case "PRAYER":
      return "Prayer support";
    case "COUNSEL":
      return "Private guidance";
    case "MEDIA":
      return "Creator media";
    default:
      return "Member post";
  }
}

function MediaActivityCard({
  item,
  label,
}: {
  item: ActivityGridItem;
  label: ChurchActivityLabel;
}) {
  const backgroundUri = activityCardBackgroundUri(item);
  const isVideo = activityIsVideo(item);
  const title = churchActivityTitle(item);
  const preview = churchActivityBody(item);
  const source: ImageSourcePropType = { uri: backgroundUri };

  return (
    <View style={s.mediaCard}>
      <ImageBackground source={source} style={s.mediaFill} resizeMode="cover">
        <LinearGradient
          colors={["rgba(0,0,0,0.05)", "rgba(0,0,0,0.28)", "rgba(0,0,0,0.88)"]}
          locations={[0, 0.45, 1]}
          style={s.mediaGradient}
        >
          {isVideo ? (
            <View style={s.playBadge}>
              <Ionicons name="play" size={14} color="#FFFFFF" />
            </View>
          ) : null}

          <View style={s.mediaOverlayBottom}>
            <View style={s.labelPill}>
              <Text style={s.labelPillText} numberOfLines={1}>
                {label}
              </Text>
            </View>
            <Text style={s.mediaTitle} numberOfLines={2}>
              {title}
            </Text>
            {preview && preview !== title ? (
              <Text style={s.mediaPreview} numberOfLines={1}>
                {preview}
              </Text>
            ) : null}
          </View>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

function TextActivityCard({
  item,
  label,
}: {
  item: ActivityGridItem;
  label: ChurchActivityLabel;
}) {
  const icon = churchActivityIcon(label) as keyof typeof Ionicons.glyphMap;

  return (
    <View style={s.textCard}>
      <View style={s.textCardTopRow}>
        <View style={s.iconWrap}>
          <Ionicons name={icon} size={16} color="#FF5A5F" />
        </View>
        <View style={s.metaPill}>
          <Text style={s.metaPillText} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>

      <View style={s.textCardBody}>
        <Text style={s.eyebrow} numberOfLines={1}>
          {labelEyebrow(label)}
        </Text>
        <Text style={s.title} numberOfLines={3}>
          {churchActivityTitle(item)}
        </Text>
        <Text style={s.body} numberOfLines={2}>
          {churchActivityBody(item)}
        </Text>
      </View>
    </View>
  );
}

export default function ChurchActivityGrid({
  items,
  emptyTitle = "No church activity yet",
  emptyBody = "Testimonies, announcements, prayer requests, and counsel posts will appear here.",
  variant = "church",
}: {
  items: ActivityGridItem[];
  emptyTitle?: string;
  emptyBody?: string;
  variant?: "church" | "media";
}) {
  if (!items.length) {
    return (
      <View style={s.emptyCard}>
        <Ionicons name="albums-outline" size={24} color="rgba(217,179,95,0.92)" />
        <Text style={s.emptyTitle}>{emptyTitle}</Text>
        <Text style={s.emptyBody}>{emptyBody}</Text>
      </View>
    );
  }

  return (
    <View style={s.grid}>
      {items.map((item) => {
        const label = getActivityGridLabel(item, variant);
        const key = String(item.id);

        if (activityHasVisualMedia(item)) {
          return <MediaActivityCard key={key} item={item} label={label} />;
        }

        return <TextActivityCard key={key} item={item} label={label} />;
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  mediaCard: {
    width: "48%",
    aspectRatio: CARD_ASPECT,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  mediaFill: {
    flex: 1,
    justifyContent: "flex-end",
  },
  mediaGradient: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 28,
  },
  playBadge: {
    position: "absolute",
    top: "38%",
    alignSelf: "center",
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  mediaOverlayBottom: {
    gap: 4,
  },
  labelPill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,90,95,0.82)",
  },
  labelPillText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  mediaTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
    letterSpacing: -0.1,
  },
  mediaPreview: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  textCard: {
    width: "48%",
    aspectRatio: CARD_ASPECT,
    borderRadius: 18,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.24)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    overflow: "hidden",
  },
  textCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  textCardBody: {
    flex: 1,
    justifyContent: "flex-end",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.22)",
  },
  metaPill: {
    maxWidth: "58%",
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,90,95,0.18)",
  },
  metaPillText: {
    color: "#FF8A8F",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 17,
    letterSpacing: -0.2,
  },
  body: {
    marginTop: 5,
    color: "rgba(255,255,255,0.68)",
    fontSize: 11.5,
    fontWeight: "700",
    lineHeight: 15,
  },
  emptyCard: {
    borderRadius: 22,
    padding: 20,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyTitle: {
    marginTop: 10,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyBody: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
});
