import React, { memo, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, Modal } from "react-native";
import { VipMediaBox } from "@/src/ui/VipMediaBox";
import { Ionicons } from "@expo/vector-icons";


function VipReadMoreText({
  text,
  maxChars = 180,
  clampLines = 4,
  textStyle,
  onExpandScrollToTop,
}: {
  text: string;
  maxChars?: number;
  clampLines?: number;
  textStyle?: any;
  onExpandScrollToTop?: (anchorY: number) => void;

}) {
  const [expanded, setExpanded] = useState(false);
  const [markerOn, setMarkerOn] = useState(false);

  React.useEffect(() => {
    if (!expanded) return;
    setMarkerOn(true);
    const t = setTimeout(() => setMarkerOn(false), 3000);
    return () => clearTimeout(t);
  }, [expanded]);

  const full = text ? String(text) : "";
  const shouldClamp = full.length > maxChars;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ position: "relative", paddingLeft: 0 }}>
        {expanded && shouldClamp && markerOn ? (
          <View
            pointerEvents="none"
            style={[
              s.readMoreMarkerDot,
              {
                top:
                  Math.max(
                    0,
                    (Math.max(1, clampLines) - 1) *
                      Number((textStyle && (textStyle.lineHeight || textStyle?.[0]?.lineHeight)) || 24)
                  ) + 6,
              },
            ]}
          />
        ) : null}

        <Text style={textStyle} numberOfLines={!expanded && shouldClamp ? clampLines : undefined}>
          {full}
        </Text>
      </View>

      {shouldClamp ? (
        <Pressable
          onPress={() => {
            const next = !expanded;
            setExpanded(next);
            // When expanding: scroll parent so post starts at top
            if (next) {
              requestAnimationFrame(() => {
                onExpandScrollToTop?.(-1);
              });
            }
          }}
          style={({ pressed }) => [
            { alignSelf: "flex-start" },
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <View style={s.readMorePill}>
          <Text style={s.readMoreText}>{expanded ? "Show less" : "Read more"}</Text>
        </View>
        </Pressable>
      ) : null}
    </View>
  );
}

export type VipPost = {
  id: string;
  createdAt?: string;
  label?: string; // e.g. "ANNOUNCEMENT"
  text?: string;
  images?: string[];
  likes?: number;
  comments?: number;
  likedByMe?: boolean;
  savedByMe?: boolean;
  meta?: string; // e.g. "Church"
};

type Props = {
  post: VipPost;
  onPressImage?: (index: number) => void;
  onToggleLike?: () => void;
  onOpenComments?: () => void;
  onToggleSave?: () => void;
  onShare?: () => void;
  onExpandScrollToTop?: (anchorY: number) => void;
  gold?: string;
  sub?: string;
  canDelete?: boolean;
  onDelete?: () => void;
};

function timeShort(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

function Dots({ n, i, gold }: { n: number; i: number; gold: string }) {
  if (n <= 1) return null;
  return (
    <View style={s.dots}>
      {Array.from({ length: n }).map((_, k) => (
        <View key={k} style={[s.dot, k === i ? { backgroundColor: gold } : null]} />
      ))}
    </View>
  );
}

function ImagePager({
  uris,
  onPressImage,
}: {
  uris: string[];
  onPressImage?: (index: number) => void;
}) {
  const [w, setW] = React.useState(0);
  const [idx, setIdx] = React.useState(0);

  if (!uris?.length) return null;

  return (
    <View style={s.pagerWrap} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const next = w ? Math.round(x / w) : 0;
          if (next !== idx) setIdx(next);
        }}
        scrollEventThrottle={16}
      >
        {uris.map((u, i) => (
          <Pressable
            key={u + "_" + i}
            onPress={() => onPressImage?.(i)}
            style={({ pressed }) => [
              s.pagerCell,
              { width: w || undefined },
              pressed && { opacity: 0.92 },
            ]}
          >
            <VipMediaBox
              uri={u}
              width={w || 360}
              minH={220}
              maxH={520}
              radius={18}
              mode="tiktok"
            />
          </Pressable>
        ))}
      </ScrollView>

      <Dots n={uris.length} i={idx} gold={"rgba(217,179,95,0.95)"} />
    </View>
  );
}


function VipPostCardInner({
  post,
  onPressImage,
  onToggleLike,
  onOpenComments,
  onToggleSave,
  onShare,
  canDelete,
  onDelete,
  onExpandScrollToTop,
  gold = "rgba(217,179,95,0.95)",
  sub = "rgba(255,255,255,0.75)",
}: Props) {
  const cardTopRef = React.useRef<View>(null);

  function handleReadMoreExpand(anchorY: number) {
    if (anchorY !== -1) {
      onExpandScrollToTop?.(anchorY);
      return;
    }
    requestAnimationFrame(() => {
      cardTopRef.current?.measureInWindow((x, y) => {
        onExpandScrollToTop?.(y);
      });
    });
  }
  const label = post.label ?? "POST";
  const t = useMemo(() => timeShort(post.createdAt), [post.createdAt]);

  const likes = post.likes ?? 0;
  const comments = post.comments ?? 0;

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View ref={cardTopRef} style={s.card}>
      <View style={s.banner}>
        <Text style={[s.bannerText, { color: gold }]}>{label}</Text>

        <View style={s.bannerRight}>
          <Text style={s.time}>{t}</Text>

          {canDelete ? (
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={10}
              style={({ pressed }) => [s.kebabBtn, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={sub} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {post.images?.length ? <ImagePager uris={post.images} onPressImage={onPressImage} /> : null}

      {post.text ? (
        <VipReadMoreText text={String((post as any)?.text ?? "")} textStyle={s.postText} onExpandScrollToTop={handleReadMoreExpand} />
      ) : null}

      <View style={s.actionsRow}>
        <Pressable onPress={onToggleLike} style={({ pressed }) => [s.actionBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Ionicons
            name={post.likedByMe ? "heart" : "heart-outline"}
            size={18}
            color={post.likedByMe ? gold : sub}
          />
          <Text style={[s.actionText, { color: sub }]}>{likes}</Text>
        </Pressable>

        <Pressable onPress={onOpenComments} style={({ pressed }) => [s.actionBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Ionicons name="chatbubble-outline" size={18} color={sub} />
          <Text style={[s.actionText, { color: sub }]}>{comments}</Text>
        </Pressable>

        <Pressable onPress={onToggleSave} style={({ pressed }) => [s.actionBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Ionicons name={post.savedByMe ? "bookmark" : "bookmark-outline"} size={18} color={post.savedByMe ? gold : sub} />
        </Pressable>

        <Pressable onPress={onShare} style={({ pressed }) => [s.actionBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Ionicons name="arrow-redo-outline" size={18} color={sub} />
        </Pressable>

        <View style={s.metaPill}>
          <Ionicons name="shield-checkmark" size={16} color={gold} />
          <Text style={[s.metaText, { color: sub }]}>{post.meta ?? "Church"}</Text>
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)} />
        <View style={s.menuSheet}>
          <Text style={s.menuTitle}>Post options</Text>

          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onDelete?.();
            }}
            style={({ pressed }) => [s.menuDangerBtn, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <Ionicons name="trash-outline" size={18} color={"#FF4D4D"} />
            <Text style={s.menuDangerText}>Delete</Text>
          </Pressable>

          <Pressable onPress={() => setMenuOpen(false)} style={({ pressed }) => [s.menuCancelBtn, pressed && { opacity: 0.92 }]}>
            <Text style={s.menuCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}


export const VipPostCard = memo(VipPostCardInner);

const s = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  bannerText: { fontSize: 14, letterSpacing: 3, fontWeight: "900" },
  time: { color: "rgba(255,255,255,0.55)", fontWeight: "900" },

  pagerWrap: {
    marginTop: 10,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  pagerCell: { alignItems: "center", justifyContent: "center" },
  pagerImg: { width: "100%", height: "100%" },
  dots: { flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 10 },
  dot: { width: 7, height: 7, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.18)" },

  postText: {
    marginTop: 10,
    color: "rgba(255,255,255,0.92)",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 22,
  },

  actionsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "nowrap",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  actionText: { fontWeight: "900" },

  metaPill: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  metaText: { fontWeight: "900" },
  readMorePill: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.38)",
  },

  readMoreText: {
    color: "#00FF66",
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  readMoreMarkerDot: {
    position: "absolute",
    left: -12,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#00FF66",
    shadowColor: "#00FF66",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  bannerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  kebabBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  menuSheet: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 16,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(12,16,24,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  menuTitle: {
    color: "rgba(255,255,255,0.82)",
    fontWeight: "900",
    letterSpacing: 0.4,
    marginBottom: 10,
  },

  menuDangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 18,
    backgroundColor: "rgba(255,0,0,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.25)",
  },

  menuDangerText: {
    color: "#FF4D4D",
    fontWeight: "900",
  },

  menuCancelBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  menuCancelText: {
    color: "rgba(255,255,255,0.80)",
    fontWeight: "900",
  },
});
