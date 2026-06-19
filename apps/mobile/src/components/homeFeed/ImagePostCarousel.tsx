import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PagerView from "@/components/PagerView";
import { ImagePostCard } from "./ImagePostCard";
import { HomeFeedImagePreviewRoot, isHomeFeedImagePreviewOpen, openHomeFeedImagePreview, useHomeFeedImagePreviewHost } from "./HomeFeedImagePreviewModal";
import type { HomeFeedPostAccent } from "./homeFeedUtils";
import { HOME_FEED_GOLD_SOFT } from "./theme";

type Props = {
  postId?: string;
  imageUris: string[];
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: HomeFeedPostAccent;
};

const MAX_CAROUSEL_IMAGES = 5;

function isChurchRoomImagePreviewAccent(accent?: HomeFeedPostAccent | null) {
  return accent === "testimony" || accent === "announcement";
}

function logCarouselPageChange(postId: string, index: number, imageCount: number) {
  console.log("KRISTO_IMAGE_CAROUSEL_PAGE_CHANGE", {
    postId: postId || null,
    index,
    imageCount,
  });
}

function logCarouselScrollBlocked(postId: string, reason: string) {
  console.log("KRISTO_IMAGE_CAROUSEL_SCROLL_BLOCKED", {
    postId: postId || null,
    reason,
  });
}

export const ImagePostCarousel = memo(function ImagePostCarousel({
  postId = "",
  imageUris,
  fallback = null,
  style,
  accent,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const isPreviewHost = useHomeFeedImagePreviewHost();
  const pagerRef = useRef<any>(null);
  const touchLoggedRef = useRef(false);
  const blockedLoggedRef = useRef(false);
  const carouselPostId = String(postId || "").trim();

  const uris = useMemo(
    () =>
      (Array.isArray(imageUris) ? imageUris : [])
        .map((uri) => String(uri || "").trim())
        .filter(Boolean)
        .slice(0, MAX_CAROUSEL_IMAGES),
    [imageUris]
  );

  const imageCount = uris.length;
  const carouselEnabled = imageCount > 1;
  const previewEnabled = isChurchRoomImagePreviewAccent(accent) && imageCount > 0;

  const urisKey = useMemo(() => uris.join("|"), [uris]);

  const openPreview = useCallback(() => {
    openHomeFeedImagePreview(uris, activeIndex);
  }, [activeIndex, uris]);

  const previewHost = isPreviewHost ? <HomeFeedImagePreviewRoot /> : null;

  const renderPreviewButton = useCallback(
    (placement: "single" | "multi") => {
      if (!previewEnabled) return null;
      return (
        <Pressable
          onPress={openPreview}
          style={[
            styles.previewButton,
            placement === "multi" ? styles.previewButtonMulti : styles.previewButtonSingle,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Preview image"
          hitSlop={8}
        >
          <Ionicons name="expand-outline" size={16} color={HOME_FEED_GOLD_SOFT} />
        </Pressable>
      );
    },
    [openPreview, previewEnabled]
  );

  useEffect(() => {
    if (isHomeFeedImagePreviewOpen()) return;
    setActiveIndex(0);
    touchLoggedRef.current = false;
    blockedLoggedRef.current = false;
    if (!carouselEnabled) return;
    requestAnimationFrame(() => {
      try {
        pagerRef.current?.setPageWithoutAnimation?.(0);
      } catch {}
    });
  }, [carouselEnabled, urisKey]);

  useEffect(() => {
    if (!carouselEnabled) return;
    const neighbors = [activeIndex - 1, activeIndex + 1].filter(
      (index) => index >= 0 && index < imageCount
    );
    for (const index of neighbors) {
      const uri = uris[index];
      if (!uri) continue;
      Image.prefetch(uri).catch(() => {});
    }
  }, [activeIndex, carouselEnabled, imageCount, uris]);

  const handleTouchStart = useCallback(() => {
    if (!carouselEnabled || touchLoggedRef.current) return;
    touchLoggedRef.current = true;
    console.log("KRISTO_IMAGE_CAROUSEL_TOUCH_START", {
      postId: carouselPostId || null,
      imageCount,
    });
  }, [carouselEnabled, carouselPostId, imageCount]);

  const handlePageSelected = useCallback(
    (event: any) => {
      const index = Number(event?.nativeEvent?.position ?? 0);
      setActiveIndex((current) => {
        if (current !== index) {
          logCarouselPageChange(carouselPostId, index, imageCount);
        }
        return index;
      });
    },
    [carouselPostId, imageCount]
  );

  const handlePageScrollStateChanged = useCallback(
    (event: any) => {
      const state = String(event?.nativeEvent?.pageScrollState || "").trim();
      if (state === "dragging" && carouselEnabled && !touchLoggedRef.current) {
        handleTouchStart();
      }
    },
    [carouselEnabled, handleTouchStart]
  );

  useEffect(() => {
    if (!carouselEnabled || blockedLoggedRef.current) return;
    if (Platform.OS === "web") {
      blockedLoggedRef.current = true;
      logCarouselScrollBlocked(carouselPostId, "web_pager_fallback");
    }
  }, [carouselEnabled, carouselPostId]);

  if (imageCount <= 1) {
    return (
      <>
        <View style={[styles.wrap, style]}>
          <ImagePostCard
            imageUri={uris[0] || ""}
            fallback={fallback}
            style={styles.pageImage}
            accent={accent}
          />
        {previewEnabled ? renderPreviewButton("single") : null}
        </View>
        {previewHost}
      </>
    );
  }

  return (
    <>
    <View
      style={[styles.wrap, style]}
      pointerEvents="auto"
      onTouchStart={handleTouchStart}
      collapsable={false}
    >
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        scrollEnabled={carouselEnabled}
        overdrag={false}
        offscreenPageLimit={1}
        onPageSelected={handlePageSelected}
        onPageScrollStateChanged={handlePageScrollStateChanged}
      >
        {uris.map((uri, index) => (
          <View key={`${uri}:${index}`} style={styles.page} collapsable={false}>
            <ImagePostCard
              imageUri={uri}
              accent={accent}
              fallback={index === 0 ? fallback : undefined}
              style={styles.pageImage}
            />
          </View>
        ))}
      </PagerView>

      <View pointerEvents="none" style={styles.counterPill}>
        <Text style={styles.counterText}>
          {activeIndex + 1}/{imageCount}
        </Text>
      </View>

      {previewEnabled ? renderPreviewButton("multi") : null}

      <View pointerEvents="none" style={styles.dotsRow}>
        {uris.map((uri, index) => (
          <View
            key={`${uri}:${index}`}
            style={[styles.dot, index === activeIndex ? styles.dotActive : null]}
          />
        ))}
      </View>
    </View>
    {previewHost}
    </>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  pageImage: {
    flex: 1,
  },
  counterPill: {
    position: "absolute",
    top: 14,
    right: 14,
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(3,5,12,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  previewButton: {
    position: "absolute",
    right: 14,
    zIndex: 4,
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,5,12,0.72)",
    borderWidth: 1,
    borderColor: "rgba(201,169,98,0.45)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  previewButtonSingle: {
    top: 14,
  },
  previewButtonMulti: {
    top: "46%",
    marginTop: -18,
  },
  dotsRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 118,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  dotActive: {
    width: 18,
    backgroundColor: "rgba(217,179,95,0.96)",
  },
});
