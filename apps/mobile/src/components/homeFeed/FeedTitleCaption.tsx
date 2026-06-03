import React, { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

const TITLE_TYPE_MS = 46;
const TITLE_FONT_SIZE = 23;
const TITLE_LINE_HEIGHT = 28;
const TITLE_HOLD_MS = 380;
const TITLE_EXIT_MS = 240;

type Props = {
  postId: string;
  title: string;
  caption: string;
  isActive: boolean;
};

/**
 * Typewriter title, brief hold, fade/collapse out, then caption alone.
 */
export const FeedTitleCaption = memo(function FeedTitleCaption({
  postId,
  title,
  caption,
  isActive,
}: Props) {
  const [visibleChars, setVisibleChars] = useState(0);
  const [showTitle, setShowTitle] = useState(false);
  const [showCaption, setShowCaption] = useState(false);
  const titleScale = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(1)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePostRef = useRef(postId);

  useEffect(() => {
    activePostRef.current = postId;
  }, [postId]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isActive) {
      setVisibleChars(0);
      setShowTitle(false);
      setShowCaption(false);
      titleScale.setValue(1);
      titleOpacity.setValue(1);
      captionOpacity.setValue(0);
      return;
    }

    const cleanTitle = String(title || "")
      .trim()
      .toUpperCase();
    const cleanCaption = String(caption || "").trim();
    const displayCaption =
      cleanCaption && cleanCaption.toUpperCase() !== cleanTitle ? cleanCaption : "";

    if (!cleanTitle && !displayCaption) {
      setVisibleChars(0);
      setShowTitle(false);
      setShowCaption(false);
      return;
    }

    if (!cleanTitle) {
      setVisibleChars(0);
      setShowTitle(false);
      setShowCaption(true);
      captionOpacity.setValue(0);
      Animated.timing(captionOpacity, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    setVisibleChars(0);
    setShowTitle(true);
    setShowCaption(false);
    titleScale.setValue(1);
    titleOpacity.setValue(1);
    captionOpacity.setValue(0);

    const revealCaption = () => {
      if (!displayCaption) return;
      if (activePostRef.current !== postId || !isActive) return;
      setShowCaption(true);
      Animated.timing(captionOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    const dismissTitle = () => {
      if (activePostRef.current !== postId || !isActive) return;
      Animated.parallel([
        Animated.timing(titleScale, {
          toValue: 0.82,
          duration: TITLE_EXIT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(titleOpacity, {
          toValue: 0,
          duration: TITLE_EXIT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || activePostRef.current !== postId || !isActive) return;
        setShowTitle(false);
        revealCaption();
      });
    };

    let index = 0;
    const tick = () => {
      if (activePostRef.current !== postId || !isActive) return;
      index += 1;
      setVisibleChars(index);

      if (index < cleanTitle.length) {
        timerRef.current = setTimeout(tick, TITLE_TYPE_MS);
        return;
      }

      timerRef.current = setTimeout(dismissTitle, TITLE_HOLD_MS);
    };

    timerRef.current = setTimeout(tick, TITLE_TYPE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive, postId, title, caption, titleScale, titleOpacity, captionOpacity]);

  const cleanTitle = String(title || "")
    .trim()
    .toUpperCase();
  const cleanCaption = String(caption || "").trim();
  const displayCaption =
    cleanCaption && cleanCaption.toUpperCase() !== cleanTitle ? cleanCaption : "";

  if (!cleanTitle && !displayCaption) return null;

  const typedTitle = cleanTitle.slice(0, visibleChars);
  const typing = showTitle && visibleChars < cleanTitle.length;

  return (
    <View style={styles.wrap}>
      {showTitle && cleanTitle ? (
        <Animated.View
          style={[
            styles.titleWrap,
            {
              transform: [{ scale: titleScale }],
              opacity: titleOpacity,
            },
          ]}
        >
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {typedTitle}
            {typing ? <Text style={styles.cursor}>|</Text> : null}
          </Text>
        </Animated.View>
      ) : null}

      {showCaption && displayCaption ? (
        <Animated.Text style={[styles.caption, { opacity: captionOpacity }]} numberOfLines={4}>
          {displayCaption}
        </Animated.Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: 4,
    marginTop: 2,
    width: "100%",
  },
  titleWrap: {
    width: "100%",
    maxWidth: "100%",
  },
  title: {
    color: "#FFFFFF",
    fontSize: TITLE_FONT_SIZE,
    lineHeight: TITLE_LINE_HEIGHT,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  cursor: {
    color: "rgba(244,208,111,0.85)",
    fontWeight: "300",
  },
  caption: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
});
