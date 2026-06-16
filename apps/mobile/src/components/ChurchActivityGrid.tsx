import React, { useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ImageBackground,
  Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import {
  activityHasVisualMedia,
  activityIsVideo,
  churchActivityTitle,
  computeActivityGridPreviewTrace,
  logActivityGridPreviewTrace,
  postAuthorName,
  type ActivityGridItem,
} from "@/src/lib/churchActivityPosts";
import MediaVideoGridPoster from "@/src/components/MediaVideoGridPoster";
import {
  hydrateMediaPosterCache,
  warmMediaPosterCacheForItems,
} from "@/src/lib/mediaPosterCache";
import {
  isValidVideoPosterUri,
  resolvePosterUri,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";

const GRID_GAP = 14;
const CARD_HEIGHT = 236;
const POSTER_AVATAR_SIZE = 22;

function postAuthorAvatarUri(item: ActivityGridItem) {
  return String(
    item?.authorAvatarUri ||
      (item as any)?.actorAvatarUri ||
      (item as any)?.avatarUri ||
      (item as any)?.profileImage ||
      (item as any)?.author?.avatarUri ||
      ""
  ).trim();
}

function PosterAvatar({ item }: { item: ActivityGridItem }) {
  const uri = postAuthorAvatarUri(item);
  const name = postAuthorName(item);
  const initial =
    String(name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  if (uri) {
    return <Image source={{ uri }} style={s.posterAvatarImage} resizeMode="cover" />;
  }

  return (
    <View style={s.posterAvatarFallback}>
      <Text style={s.posterAvatarInitial}>{initial}</Text>
    </View>
  );
}

function AuthorIdentityRow({ item }: { item: ActivityGridItem }) {
  return (
    <View style={s.authorRow}>
      <PosterAvatar item={item} />
      <Text style={s.authorName} numberOfLines={1}>
        {postAuthorName(item)}
      </Text>
    </View>
  );
}

function MediaActivityCard({
  item,
  onPress,
  variant = "church",
}: {
  item: ActivityGridItem;
  onPress?: () => void;
  variant?: "church" | "media";
}) {
  const previewTrace = useMemo(() => computeActivityGridPreviewTrace(item), [item]);
  const posterUri = useMemo(() => resolvePosterUri(item), [item]);
  const videoUri = useMemo(
    () => String(item?.videoUrl || resolveVideoUri(item) || previewTrace.resolvedVideoUri || "").trim(),
    [item, previewTrace.resolvedVideoUri]
  );
  const hasValidPoster = isValidVideoPosterUri(posterUri, videoUri);
  const backgroundUri = hasValidPoster ? posterUri : previewTrace.finalPreviewUri;
  const fallbackTitle = churchActivityTitle(item);
  const isVideo = activityIsVideo(item);

  useEffect(() => {
    logActivityGridPreviewTrace(previewTrace, {
      variant,
      isVideo,
      posterUri,
      hasValidPoster,
      backgroundUri,
    });
  }, [
    previewTrace.postId,
    previewTrace.resolvedPreviewUrl,
    previewTrace.resolvedVideoUri,
    previewTrace.inferredPosterUri,
    variant,
    isVideo,
    posterUri,
    hasValidPoster,
    backgroundUri,
  ]);
  const cardOverlay = (
    <LinearGradient
      colors={["transparent", "rgba(0,0,0,0.42)", "rgba(0,0,0,0.82)"]}
      locations={[0, 0.55, 1]}
      style={s.mediaGradient}
    >
      {isVideo ? (
        <View style={s.playBadge}>
          <Ionicons name="play" size={15} color="#FFFFFF" />
        </View>
      ) : null}
      <AuthorIdentityRow item={item} />
    </LinearGradient>
  );

  return (
    <Pressable onPress={onPress} style={s.cardBase}>
      {isVideo ? (
        <View style={s.mediaFill}>
          <MediaVideoGridPoster
            item={item}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
            postId={previewTrace.postId}
            videoUrl={videoUri}
          />
          {cardOverlay}
        </View>
      ) : backgroundUri ? (
        <ImageBackground source={{ uri: backgroundUri }} style={s.mediaFill} resizeMode="cover">
          {cardOverlay}
        </ImageBackground>
      ) : (
        <LinearGradient
          colors={["#141A28", "#0A0F18", "#05070D"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.mediaFill}
        >
          {cardOverlay}
        </LinearGradient>
      )}
    </Pressable>
  );
}

function TextActivityCard({
  item,
  onPress,
}: {
  item: ActivityGridItem;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.cardBase, s.textCard]}>
      <LinearGradient
        colors={["rgba(18,16,10,0.96)", "rgba(8,10,16,0.98)", "rgba(4,6,12,1)"]}
        locations={[0, 0.55, 1]}
        style={s.textGradient}
      >
        <AuthorIdentityRow item={item} />
      </LinearGradient>
    </Pressable>
  );
}

export default function ChurchActivityGrid({
  items,
  emptyTitle = "No church activity yet",
  emptyBody = "Posts from church members will appear here.",
  onItemPress,
  variant = "church",
}: {
  items: ActivityGridItem[];
  emptyTitle?: string;
  emptyBody?: string;
  variant?: "church" | "media";
  onItemPress?: (item: ActivityGridItem) => void;
}) {
  useEffect(() => {
    if (variant !== "media" || !items.length) return;

    let cancelled = false;
    void (async () => {
      await hydrateMediaPosterCache();
      if (cancelled) return;

      const visibleCount = Math.min(items.length, 8);
      await warmMediaPosterCacheForItems(items, 0, visibleCount);

      if (cancelled || items.length <= visibleCount) return;
      await warmMediaPosterCacheForItems(
        items,
        visibleCount,
        Math.min(items.length - visibleCount, 8)
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [items, variant]);

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
        const key = String(item.id);
        const handlePress = onItemPress ? () => onItemPress(item) : undefined;

        if (activityHasVisualMedia(item)) {
          return (
            <MediaActivityCard
              key={key}
              item={item}
              onPress={handlePress}
              variant={variant}
            />
          );
        }

        return <TextActivityCard key={key} item={item} onPress={handlePress} />;
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
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 28,
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
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: POSTER_AVATAR_SIZE,
  },
  posterAvatarImage: {
    width: POSTER_AVATAR_SIZE,
    height: POSTER_AVATAR_SIZE,
    borderRadius: POSTER_AVATAR_SIZE / 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  posterAvatarFallback: {
    width: POSTER_AVATAR_SIZE,
    height: POSTER_AVATAR_SIZE,
    borderRadius: POSTER_AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  posterAvatarInitial: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
  authorName: {
    flex: 1,
    color: "rgba(255,255,255,0.94)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  textCard: {
    borderColor: "rgba(217,179,95,0.16)",
  },
  textGradient: {
    flex: 1,
    paddingHorizontal: 10,
    paddingBottom: 10,
    justifyContent: "flex-end",
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
