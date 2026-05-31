import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  Pressable,
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
  formatActivityWhen,
  getActivityGridLabel,
  postAuthorName,
  type ActivityGridItem,
  type ChurchActivityLabel,
} from "@/src/lib/churchActivityPosts";

const GRID_GAP = 14;
const CARD_HEIGHT = 236;

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

function ActivityMetaRow({ item }: { item: ActivityGridItem }) {
  const author = postAuthorName(item);
  const when = formatActivityWhen(item.createdAt);

  return (
    <View style={s.metaRow}>
      <Text style={s.metaAuthor} numberOfLines={1}>
        {author}
      </Text>
      {when ? (
        <>
          <Text style={s.metaDot}>•</Text>
          <Text style={s.metaWhen} numberOfLines={1}>
            {when}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function MediaActivityCard({
  item,
  label,
  onPress,
}: {
  item: ActivityGridItem;
  label: ChurchActivityLabel;
  onPress?: () => void;
}) {
  const backgroundUri = activityCardBackgroundUri(item);
  const isVideo = activityIsVideo(item);
  const title = churchActivityTitle(item);
  const preview = churchActivityBody(item);
  const source: ImageSourcePropType = { uri: backgroundUri };

  return (
    <Pressable onPress={onPress} style={s.cardBase}>
      <ImageBackground source={source} style={s.mediaFill} resizeMode="cover">
        <LinearGradient
          colors={[
            "rgba(0,0,0,0.12)",
            "rgba(0,0,0,0.34)",
            "rgba(0,0,0,0.72)",
            "rgba(0,0,0,0.96)",
          ]}
          locations={[0, 0.34, 0.72, 1]}
          style={s.mediaGradient}
        >
          {isVideo ? (
            <View style={s.playBadge}>
              <Ionicons name="play" size={15} color="#FFFFFF" />
            </View>
          ) : null}

          <View style={s.cardBottom}>
            <View style={s.labelPill}>
              <Text style={s.labelPillText} numberOfLines={1}>
                {label}
              </Text>
            </View>
            <Text style={s.mediaTitle} numberOfLines={2}>
              {title}
            </Text>
            {preview && preview !== title ? (
              <Text style={s.mediaPreview} numberOfLines={2}>
                {preview}
              </Text>
            ) : null}
            <ActivityMetaRow item={item} />
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

function TextActivityCard({
  item,
  label,
  onPress,
}: {
  item: ActivityGridItem;
  label: ChurchActivityLabel;
  onPress?: () => void;
}) {
  const icon = churchActivityIcon(label) as keyof typeof Ionicons.glyphMap;

  return (
    <Pressable onPress={onPress} style={[s.cardBase, s.textCard]}>
      <LinearGradient
        colors={["rgba(18,16,10,0.96)", "rgba(8,10,16,0.98)", "rgba(4,6,12,1)"]}
        locations={[0, 0.55, 1]}
        style={s.textGradient}
      >
        <View style={s.textCardTopRow}>
          <View style={s.iconWrap}>
            <Ionicons name={icon} size={15} color="#F4D06F" />
          </View>
          <View style={s.labelPill}>
            <Text style={s.labelPillText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>

        <View style={s.cardBottom}>
          <Text style={s.eyebrow} numberOfLines={1}>
            {labelEyebrow(label)}
          </Text>
          <Text style={s.title} numberOfLines={2}>
            {churchActivityTitle(item)}
          </Text>
          <Text style={s.body} numberOfLines={2}>
            {churchActivityBody(item)}
          </Text>
          <ActivityMetaRow item={item} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export default function ChurchActivityGrid({
  items,
  emptyTitle = "No church activity yet",
  emptyBody = "Posts from church members will appear here.",
  variant = "church",
  onItemPress,
}: {
  items: ActivityGridItem[];
  emptyTitle?: string;
  emptyBody?: string;
  variant?: "church" | "media";
  onItemPress?: (item: ActivityGridItem) => void;
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
        const handlePress = onItemPress ? () => onItemPress(item) : undefined;

        if (activityHasVisualMedia(item)) {
          return (
            <MediaActivityCard
              key={key}
              item={item}
              label={label}
              onPress={handlePress}
            />
          );
        }

        return (
          <TextActivityCard
            key={key}
            item={item}
            label={label}
            onPress={handlePress}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  cardBase: {
    width: "48%",
    height: CARD_HEIGHT,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.14)",
  },
  mediaFill: {
    flex: 1,
    justifyContent: "flex-end",
  },
  mediaGradient: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 13,
    paddingBottom: 13,
    paddingTop: 36,
  },
  playBadge: {
    position: "absolute",
    top: "34%",
    alignSelf: "center",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.52)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  cardBottom: {
    gap: 5,
  },
  labelPill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(8,10,14,0.82)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  },
  labelPillText: {
    color: "#F4D06F",
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  mediaTitle: {
    color: "#FFFFFF",
    fontSize: 13.5,
    fontWeight: "900",
    lineHeight: 17,
    letterSpacing: -0.15,
  },
  mediaPreview: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  textCard: {
    borderColor: "rgba(217,179,95,0.16)",
  },
  textGradient: {
    flex: 1,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 13,
    justifyContent: "space-between",
  },
  textCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 17,
    letterSpacing: -0.15,
  },
  body: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 11.5,
    fontWeight: "700",
    lineHeight: 15,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 1,
    minHeight: 14,
  },
  metaAuthor: {
    flexShrink: 1,
    color: "rgba(255,255,255,0.84)",
    fontSize: 10,
    fontWeight: "800",
  },
  metaDot: {
    color: "rgba(255,255,255,0.34)",
    fontSize: 10,
    fontWeight: "900",
  },
  metaWhen: {
    flexShrink: 0,
    color: "rgba(255,255,255,0.52)",
    fontSize: 10,
    fontWeight: "700",
  },
  emptyCard: {
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.14)",
    marginBottom: 8,
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
