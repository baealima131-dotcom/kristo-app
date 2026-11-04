import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { FeedCommentsSheet } from "@/src/components/homeFeed/FeedCommentsSheet";
import { fetchFeedComments, formatCommentTime, normalizeCommentPostId } from "@/src/lib/homeFeedComments";

const C = {
  bg: "#0B0F17",
  glass: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.14)",
  gold: "rgba(217,179,95,0.95)",
  text: {
    primary: "rgba(255,255,255,0.96)",
    secondary: "rgba(255,255,255,0.72)",
    muted: "rgba(255,255,255,0.52)",
  },
};

type PostItem = {
  id: string;
  type?: string;
  title?: string;
  text?: string;
  body?: string;
  mediaUri?: string;
  imageUri?: string;
  posterUri?: string;
  videoPosterUri?: string;
  createdAt?: string;
  actorLabel?: string;
  authorName?: string;
  churchName?: string;
};

/**
 * Church tab post: the post plus its comments. Comments, replies and likes go through the
 * shared feed comment sheet (GET /api/church/feed?id=…, POST add_comment / add_reply) with the
 * signed session headers; the backend only shows/accepts them for posts visible to the
 * viewer's church.
 */
export default function ChurchPostScreen() {
  const params = useLocalSearchParams<{ id?: string; comments?: string }>();
  const postId = normalizeCommentPostId(String(params.id || ""));

  const [item, setItem] = useState<PostItem | null>(null);
  const [discussionCount, setDiscussionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!postId) {
      setError("Post not found.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await fetchFeedComments(postId, { bypassCache: true });
    if (res.ok) {
      setItem((res.item as PostItem) || { id: postId });
      setDiscussionCount(Number(res.discussionCount || 0));
      setError("");
    } else {
      setItem(null);
      setError(
        /not found/i.test(res.error)
          ? "This post is not available. Posts created only on this device have no comments."
          : res.error || "Could not load the post."
      );
    }
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (item && String(params.comments || "") === "1") setCommentsOpen(true);
  }, [item, params.comments]);

  const title = String(item?.title || "").trim();
  const body = String(item?.text || item?.body || "").trim();
  const author = String(item?.actorLabel || item?.authorName || "").trim();
  const churchName = String(item?.churchName || "").trim();
  const image = String(item?.mediaUri || item?.imageUri || item?.posterUri || item?.videoPosterUri || "").trim();
  const showImage = /^https?:\/\//i.test(image);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.gold} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={28} color={C.text.muted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            {author || churchName ? (
              <Text style={styles.meta} numberOfLines={1}>
                {[author, churchName].filter(Boolean).join(" • ")}
              </Text>
            ) : null}
            {item?.createdAt ? <Text style={styles.time}>{formatCommentTime(item.createdAt)}</Text> : null}
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {showImage ? <Image source={{ uri: image }} style={styles.image} contentFit="cover" /> : null}
            {body ? <Text style={styles.body}>{body}</Text> : null}
          </View>

          <Pressable onPress={() => setCommentsOpen(true)} style={styles.commentsBtn}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.gold} />
            <Text style={styles.commentsBtnText}>
              {discussionCount > 0 ? `Comments (${discussionCount})` : "Comments"}
            </Text>
          </Pressable>
        </ScrollView>
      )}

      {item ? (
        <FeedCommentsSheet
          visible={commentsOpen}
          postId={postId}
          railDiscussionCount={discussionCount}
          onClose={() => setCommentsOpen(false)}
          onDiscussionCountChange={(_id, count) => setDiscussionCount(count)}
          onDiscussionCountBump={(_id, delta) => setDiscussionCount((n) => Math.max(0, n + delta))}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: C.text.primary, fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  errorText: { color: C.text.secondary, fontSize: 15, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderColor: C.gold, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: C.gold, fontWeight: "700" },
  content: { padding: 16, gap: 14 },
  card: {
    backgroundColor: C.glass,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  meta: { color: C.text.secondary, fontSize: 13, fontWeight: "600" },
  time: { color: C.text.muted, fontSize: 12 },
  title: { color: C.text.primary, fontSize: 18, fontWeight: "800" },
  image: { width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)" },
  body: { color: C.text.primary, fontSize: 15, lineHeight: 22 },
  commentsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.gold,
    borderRadius: 22,
    paddingVertical: 12,
  },
  commentsBtnText: { color: C.gold, fontSize: 15, fontWeight: "700" },
});
