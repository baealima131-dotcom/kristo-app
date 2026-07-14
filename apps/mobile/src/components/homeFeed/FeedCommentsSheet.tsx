import {
  submitHomeFeedReport,
} from "@/src/lib/homeFeedReport";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  appendReplyToComment,
  appendRootComment,
  buildOptimisticComment,
  commentCacheKey,
  enrichCommentsFromLocalProfiles,
  fetchFeedComments,
  mergeCommentsAfterSuccessfulPost,
  normalizeCommentPostId,
  reloadFeedCommentsAfterPost,
  formatCommentTime,
  mentionPrefixForAuthor,
  patchCommentLikeInTree,
  removeCommentFromTree,
  replaceCommentInTree,
  resolveCommentAuthor,
  sessionUserId,
  submitFeedComment,
  submitFeedReply,
  toggleFeedCommentLike,
  userHasActiveChurchMembership,
  type FeedCommentNode,
} from "@/src/lib/homeFeedComments";
import { commentAvatarUrl } from "./homeFeedUtils";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

const COMMENT_COLLAPSED_LINES = 3;
const COMMENT_LONG_CHAR_THRESHOLD = 160;
const AVATAR_MAIN = 44;
const AVATAR_REPLY = 36;
const LIST_BOTTOM_PADDING = 20;
const AVATAR_GAP = 12;
const FOOTER_PADDING_KEYBOARD = 10;

const avatarResolveLoggedIds = new Set<string>();

function logCommentAvatarResolve(
  commentId: string,
  payload: {
    hasAvatarUri: boolean;
    avatarUri: string;
    displayName: string;
    fallbackLetter: string;
  }
) {
  const id = String(commentId || "").trim();
  if (!id || avatarResolveLoggedIds.has(id)) return;
  avatarResolveLoggedIds.add(id);
  console.log("KRISTO_COMMENT_AVATAR_RESOLVE", {
    commentId: id,
    ...payload,
  });
}

function fallbackLetterForName(displayName: string) {
  const letter = String(displayName || "U")
    .trim()
    .charAt(0)
    .toUpperCase();
  return letter || "U";
}

function resolveAvatarUriForNode(node: FeedCommentNode) {
  const display = resolveCommentAuthor(node);
  const candidates = [
    node.authorAvatarUri,
    display.authorAvatarUri,
  ];

  for (const candidate of candidates) {
    const uri = commentAvatarUrl(candidate);
    if (uri) return uri;
  }

  return commentAvatarUrl(node.authorAvatarUri || display.authorAvatarUri || "");
}

type Props = {
  visible: boolean;
  postId: string;
  railDiscussionCount?: number;
  onClose: () => void;
  onDiscussionCountChange: (postId: string, count: number) => void;
  onDiscussionCountBump: (postId: string, delta: number) => void;
};

function CommentAvatar({
  commentId,
  avatarUri,
  displayName,
  size,
}: {
  commentId: string;
  avatarUri: string;
  displayName: string;
  size: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const fallbackLetter = fallbackLetterForName(displayName);
  const resolvedUri = String(avatarUri || "").trim();
  const showPhoto = Boolean(resolvedUri) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedUri]);

  useEffect(() => {
    logCommentAvatarResolve(commentId, {
      hasAvatarUri: Boolean(resolvedUri),
      avatarUri: resolvedUri,
      displayName,
      fallbackLetter,
    });
  }, [commentId, resolvedUri, displayName, fallbackLetter]);

  return (
    <View
      style={[
        styles.avatarSlot,
        {
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          marginRight: AVATAR_GAP,
        },
      ]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: resolvedUri }}
          style={[
            styles.avatarImage,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            styles.avatarRing,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[styles.avatarInitial, { fontSize: Math.round(size * 0.38) }]}>
            {fallbackLetter}
          </Text>
        </View>
      )}
    </View>
  );
}

function ExpandableCommentText({
  text,
  variant,
  commentId,
}: {
  text: string;
  variant: "comment" | "reply";
  commentId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong =
    text.length > COMMENT_LONG_CHAR_THRESHOLD || text.split("\n").length > COMMENT_COLLAPSED_LINES;

  if (!isLong) {
    return (
      <Text style={variant === "comment" ? styles.commentText : styles.replyText}>{text}</Text>
    );
  }

  return (
    <View>
      <Text
        style={variant === "comment" ? styles.commentText : styles.replyText}
        numberOfLines={expanded ? undefined : COMMENT_COLLAPSED_LINES}
      >
        {text}
      </Text>
      <Pressable
        onPress={() => {
          const next = !expanded;
          if (next) {
            console.log("KRISTO_COMMENT_SEE_MORE", { commentId });
          }
          setExpanded(next);
        }}
        hitSlop={8}
      >
        <Text style={styles.seeMoreText}>{expanded ? "See less" : "See more"}</Text>
      </Pressable>
    </View>
  );
}

function ReplyRow({
  reply,
  onToggleLike,
  onReport,
}: {
  reply: FeedCommentNode;
  onToggleLike: (commentId: string) => void;
  onReport: (commentId: string) => void;
}) {
  const display = resolveCommentAuthor(reply);
  const avatarUri = resolveAvatarUriForNode(reply);

  return (
    <View style={styles.replyRow}>
      <CommentAvatar
        commentId={reply.id}
        avatarUri={avatarUri}
        displayName={display.authorName}
        size={AVATAR_REPLY}
      />
      <View style={styles.commentContent}>
        <View style={styles.nameRow}>
          <Text style={styles.replyName} numberOfLines={1}>
            {display.authorName}
          </Text>
          <Text style={styles.timeText}>{formatCommentTime(reply.createdAt)}</Text>
        </View>
        <ExpandableCommentText text={reply.text} variant="reply" commentId={reply.id} />
        <View style={styles.replyMetaRow}>
          <Pressable onPress={() => onToggleLike(reply.id)} hitSlop={8}>
            <Text style={[styles.likeText, reply.likedByMe ? styles.likeTextActive : null]}>
              {reply.likedByMe ? "♥" : "♡"} {reply.likeCount}
            </Text>
          </Pressable>
          <Pressable onPress={() => onReport(reply.id)} hitSlop={8}>
            <Text style={styles.reportCommentBtn}>Report Comment</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function RepliesSection({
  comment,
  onToggleLike,
  onReport,
}: {
  comment: FeedCommentNode;
  onToggleLike: (commentId: string) => void;
  onReport: (commentId: string) => void;
}) {
  const replyCount = comment.replies.length;
  const [expanded, setExpanded] = useState(true);

  if (!replyCount) return null;

  const label =
    replyCount === 1 ? "1 Reply" : `${replyCount} Replies`;

  const toggle = () => {
    const next = !expanded;
    console.log(next ? "KRISTO_REPLY_EXPAND" : "KRISTO_REPLY_COLLAPSE", {
      commentId: comment.id,
      replyCount,
    });
    setExpanded(next);
  };

  return (
    <View style={styles.repliesWrap}>
      <Pressable onPress={toggle} hitSlop={8}>
        <Text style={styles.repliesToggle}>
          {expanded ? `Hide ${label.toLowerCase()}` : label}
        </Text>
      </Pressable>
      {expanded
        ? comment.replies.map((reply) => (
            <ReplyRow
              key={reply.id}
              reply={reply}
              onToggleLike={onToggleLike}
              onReport={onReport}
            />
          ))
        : null}
    </View>
  );
}

function CommentRow({
  comment,
  onReply,
  onToggleLike,
  onReport,
}: {
  comment: FeedCommentNode;
  onReply: (comment: FeedCommentNode) => void;
  onToggleLike: (commentId: string) => void;
  onReport: (commentId: string) => void;
}) {
  const display = resolveCommentAuthor(comment);
  const avatarUri = resolveAvatarUriForNode(comment);

  return (
    <View style={styles.commentCard}>
      <View style={styles.commentRow}>
        <CommentAvatar
          commentId={comment.id}
          avatarUri={avatarUri}
          displayName={display.authorName}
          size={AVATAR_MAIN}
        />
        <View style={styles.commentContent}>
          <View style={styles.nameRow}>
            <Text style={styles.commentName} numberOfLines={1}>
              {display.authorName}
            </Text>
            <Text style={styles.timeText}>{formatCommentTime(comment.createdAt)}</Text>
          </View>
          <ExpandableCommentText text={comment.text} variant="comment" commentId={comment.id} />
          <View style={styles.commentActions}>
            <Pressable onPress={() => onToggleLike(comment.id)} hitSlop={8}>
              <Text style={[styles.likeText, comment.likedByMe ? styles.likeTextActive : null]}>
                {comment.likedByMe ? "♥" : "♡"} {comment.likeCount}
              </Text>
            </Pressable>
            <Pressable onPress={() => onReply(comment)} hitSlop={8}>
              <Text style={styles.replyBtn}>Reply</Text>
            </Pressable>
            <Pressable onPress={() => onReport(comment.id)} hitSlop={8}>
              <Text style={styles.reportCommentBtn}>Report</Text>
            </Pressable>
          </View>
          <RepliesSection comment={comment} onToggleLike={onToggleLike} onReport={onReport} />
        </View>
      </View>
    </View>
  );
}

function findReportedComment(
  nodes: any[],
  commentId: string
): any | null {
  const targetId =
    String(commentId || "").trim();

  for (const node of Array.isArray(nodes)
    ? nodes
    : []) {
    if (
      String(node?.id || "").trim() ===
      targetId
    ) {
      return node;
    }

    const found =
      findReportedComment(
        Array.isArray(node?.replies)
          ? node.replies
          : [],
        targetId
      );

    if (found) {
      return found;
    }
  }

  return null;
}

function CommentReportModal({
  visible,
  postId,
  comment,
  onClose,
}: {
  visible: boolean;
  postId: string;
  comment: any | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [submitting, setSubmitting] =
    React.useState(false);

  const commentId =
    String(comment?.id || "").trim();

  const submitReport =
    React.useCallback(async () => {
      if (
        submitting ||
        !postId ||
        !commentId
      ) {
        return;
      }

      setSubmitting(true);

      try {
        const displayName =
          String(
            comment?.displayName ||
            comment?.authorName ||
            comment?.userName ||
            comment?.name ||
            "Comment author"
          ).trim();

        const avatarUri =
          String(
            comment?.avatarUri ||
            comment?.avatarUrl ||
            comment?.profileImage ||
            comment?.photoURL ||
            ""
          ).trim();

        const ownerUserId =
          String(
            comment?.userId ||
            comment?.authorUserId ||
            comment?.createdByUserId ||
            ""
          ).trim();

        const commentText =
          String(
            comment?.text ||
            comment?.body ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();

        const result =
          await submitHomeFeedReport({
            postId,
            reason:
              "Other" as any,

            details:
              "Reported a feed comment.",

            targetType:
              "comment",

            targetId:
              commentId,

            sourceMessageId:
              commentId,

            targetTitle:
              displayName,

            targetOwnerName:
              displayName,

            targetOwnerUserId:
              ownerUserId,

            targetPreview:
              commentText,

            targetThumbnailUri:
              avatarUri,
          });

        if (!result.ok) {
          throw new Error(
            result.error ||
            "Could not report comment."
          );
        }

        onClose();

        Alert.alert(
          "Comment reported",
          result.reportCode
            ? [
                "Your Report Command Code:",
                "",
                result.reportCode,
                "",
                "You can follow its status in My Reports.",
              ].join("\n")
            : "Your comment report was submitted."
        );
      } catch (error: any) {
        Alert.alert(
          "Could not report comment",
          String(
            error?.message ||
            "Please try again."
          )
        );
      } finally {
        setSubmitting(false);
      }
    }, [
      comment,
      commentId,
      onClose,
      postId,
      submitting,
    ]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.reportBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.reportSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Report Comment</Text>
          <Text style={styles.reportSubtitle}>
            Help us review comments that violate community standards. Moderation review is coming
            soon.
          </Text>
          <View style={styles.reportReadyBox}>
            <Ionicons name="flag-outline" size={20} color={HOME_FEED_GOLD_SOFT} />
            <Text
              style={styles.reportReadyText}
              numberOfLines={3}
            >
              {String(
                comment?.text ||
                "Selected comment"
              ).trim()}
            </Text>
          </View>
          <Pressable
            style={styles.submitBtn}
            disabled={submitting}
            onPress={() => {
              void submitReport();
            }}
          >
            <Text style={styles.submitBtnText}>
              {submitting
                ? "Submitting..."
                : "Submit report"}
            </Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={onClose} hitSlop={10}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const FeedCommentsSheet = memo(function FeedCommentsSheet({
  visible,
  postId,
  railDiscussionCount = 0,
  onClose,
  onDiscussionCountChange,
  onDiscussionCountBump,
}: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const sendingRef = useRef(false);
  const loadSeqRef = useRef(0);
  const commentsRef = useRef<FeedCommentNode[]>([]);
  const postIdRef = useRef(postId);
  const railCountRef = useRef(railDiscussionCount);
  const lastOpenScopeKeyRef = useRef("");
  const viewerUserId = sessionUserId();

  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [comments, setComments] = useState<FeedCommentNode[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<FeedCommentNode | null>(null);
  const [error, setError] = useState("");
  const [reportCommentId, setReportCommentId] = useState("");

  useEffect(() => {
    console.log("KRISTO_COMMENT_SHEET_VISIBLE", {
      visible,
      postId,
    });
  }, [visible, postId]);

  const resetDraft = useCallback(() => {
    setDraft("");
    setReplyTo(null);
    setError("");
  }, []);

  const onDiscussionCountChangeRef = useRef(onDiscussionCountChange);
  onDiscussionCountChangeRef.current = onDiscussionCountChange;
  postIdRef.current = postId;
  railCountRef.current = railDiscussionCount;
  commentsRef.current = comments;

  const runCommentLoad = useCallback(async () => {
    const cleanPostId = normalizeCommentPostId(postIdRef.current);
    if (!cleanPostId) return;

    const loadScope = commentCacheKey(cleanPostId);
    const seq = ++loadSeqRef.current;
    console.log("KRISTO_COMMENTS_LOAD_START", {
      postId: cleanPostId,
      viewerUserId: loadScope.viewerUserId,
      seq,
    });

    setLoading(true);
    setError("");
    setInitialLoadDone(false);

    const isStaleLoad = () => {
      if (seq !== loadSeqRef.current) return true;
      const currentScope = commentCacheKey(postIdRef.current);
      return currentScope.key !== loadScope.key;
    };

    const applyFetch = async (isRetry: boolean): Promise<void> => {
      const result = await fetchFeedComments(cleanPostId, { bypassCache: true });

      if (isStaleLoad()) {
        console.log("KRISTO_COMMENTS_STALE_USER_IGNORED", {
          postId: cleanPostId,
          viewerUserId: loadScope.viewerUserId,
          seq,
        });
        return;
      }

      if (!result.ok) {
        setLoading(false);
        setInitialLoadDone(true);
        if (commentsRef.current.length === 0) {
          setError(result.error);
        }
        return;
      }

      const enriched = await enrichCommentsFromLocalProfiles(result.comments);

      if (isStaleLoad()) {
        console.log("KRISTO_COMMENTS_STALE_USER_IGNORED", {
          postId: cleanPostId,
          viewerUserId: loadScope.viewerUserId,
          seq,
        });
        return;
      }

      const previousCount = commentsRef.current.length;
      const loadedCount = enriched.length;
      const railCount = railCountRef.current;

      if (previousCount > 0 && loadedCount === 0) {
        console.log("KRISTO_COMMENTS_EMPTY_RESPONSE_SKIPPED", {
          postId: cleanPostId,
          seq,
          previousCount,
        });
        if (!isRetry) {
          await applyFetch(true);
          return;
        }
        setLoading(false);
        setInitialLoadDone(true);
        return;
      }

      if (railCount > 0 && loadedCount === 0) {
        console.log("KRISTO_COMMENTS_COUNT_LIST_MISMATCH", {
          postId: cleanPostId,
          railCount,
          loadedCount,
        });
        if (!isRetry) {
          await applyFetch(true);
          return;
        }
        setLoading(false);
        setInitialLoadDone(true);
        return;
      }

      setComments(enriched);
      setLoading(false);
      setInitialLoadDone(true);
      console.log("KRISTO_COMMENTS_APPLY_STATE", {
        postId: cleanPostId,
        viewerUserId: loadScope.viewerUserId,
        count: loadedCount,
        authorNames: enriched.map((c) => c.authorName),
      });
      console.log("KRISTO_COMMENTS_LOAD_APPLY", {
        postId: cleanPostId,
        viewerUserId: loadScope.viewerUserId,
        seq,
        count: loadedCount,
      });

      if (result.discussionCount > 0) {
        onDiscussionCountChangeRef.current(cleanPostId, result.discussionCount);
      } else if (loadedCount > 0) {
        onDiscussionCountChangeRef.current(cleanPostId, loadedCount);
      }
    };

    try {
      await applyFetch(false);
    } catch {
      if (!isStaleLoad()) {
        setLoading(false);
        setInitialLoadDone(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!visible || !postId) return;

    const scope = commentCacheKey(postId);
    console.log("KRISTO_COMMENTS_CACHE_KEY", {
      postId: scope.postId,
      viewerUserId: scope.viewerUserId,
    });

    if (lastOpenScopeKeyRef.current !== scope.key) {
      loadSeqRef.current += 1;
      setComments([]);
      setInitialLoadDone(false);
      lastOpenScopeKeyRef.current = scope.key;
    }

    console.log("KRISTO_COMMENTS_OPEN", {
      postId: scope.postId,
      viewerUserId: scope.viewerUserId,
    });
    resetDraft();
    void runCommentLoad();
  }, [visible, postId, viewerUserId, resetDraft, runCommentLoad]);

  useEffect(() => {
    if (visible) return;
    loadSeqRef.current += 1;
    avatarResolveLoggedIds.clear();
  }, [visible]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const footerBottomPadding = keyboardVisible
    ? FOOTER_PADDING_KEYBOARD
    : Math.max(insets.bottom, 12);

  const ensureMembership = useCallback(() => {
    const session = getSessionSync();
    if (!userHasActiveChurchMembership(session)) {
      Alert.alert("Join a church", "Join a church to comment on posts.");
      return false;
    }
    return true;
  }, []);

  const handleReportComment = useCallback((commentId: string) => {
    setReportCommentId(commentId);
  }, []);

  const handleToggleLike = useCallback(async (commentId: string) => {
    if (!commentId) return;

    let previous: FeedCommentNode | null = null;

    setComments((prev) => {
      const findNode = (nodes: FeedCommentNode[]): FeedCommentNode | null => {
        for (const node of nodes) {
          if (node.id === commentId) return node;
          const nested = findNode(node.replies);
          if (nested) return nested;
        }
        return null;
      };
      previous = findNode(prev);
      if (!previous) return prev;

      const nextLiked = !previous.likedByMe;
      const nextCount = Math.max(0, previous.likeCount + (nextLiked ? 1 : -1));
      return patchCommentLikeInTree(prev, commentId, {
        likedByMe: nextLiked,
        likeCount: nextCount,
      });
    });

    const result = await toggleFeedCommentLike(commentId);
    if (!result.ok) {
      if (previous) {
        setComments((prev) =>
          patchCommentLikeInTree(prev, commentId, {
            likedByMe: previous!.likedByMe,
            likeCount: previous!.likeCount,
          })
        );
      }
      return;
    }

    setComments((prev) =>
      patchCommentLikeInTree(prev, commentId, {
        likedByMe: result.likedByMe,
        likeCount: result.likeCount,
      })
    );
  }, []);

  const handleSend = useCallback(async () => {
    if (sendingRef.current || !postId) return;
    const text = String(draft || "").trim();
    if (!text) return;
    if (!ensureMembership()) return;

    sendingRef.current = true;
    setSending(true);
    setError("");

    const cleanPostId = normalizeCommentPostId(postId);
    if (!cleanPostId) return;

    onDiscussionCountBump(cleanPostId, 1);

    const optimistic = buildOptimisticComment(cleanPostId, text, replyTo?.id);
    console.log("KRISTO_COMMENT_OPTIMISTIC_ADD", {
      postId: cleanPostId,
      tempId: optimistic.id,
      text: text.slice(0, 120),
    });

    if (replyTo) {
      setComments((prev) => appendReplyToComment(prev, replyTo.id, optimistic));
    } else {
      setComments((prev) => appendRootComment(prev, optimistic));
    }

    setDraft("");

    const result = replyTo
      ? await submitFeedReply(cleanPostId, replyTo.id, text)
      : await submitFeedComment(cleanPostId, text);

    sendingRef.current = false;
    setSending(false);

    if (!result.ok) {
      onDiscussionCountBump(cleanPostId, -1);
      setComments((prev) => removeCommentFromTree(prev, optimistic.id));
      setError(result.error);
      setDraft(text);
      return;
    }

    const sendScope = commentCacheKey(cleanPostId);
    let reloaded: FeedCommentNode[] = [];
    if (!result.comment) {
      const reload = await reloadFeedCommentsAfterPost(cleanPostId);
      const currentScope = commentCacheKey(cleanPostId);
      if (currentScope.key !== sendScope.key) {
        console.log("KRISTO_COMMENTS_STALE_USER_IGNORED", {
          postId: cleanPostId,
          viewerUserId: sendScope.viewerUserId,
          stage: "post-send-reload",
        });
      } else if (reload.ok) {
        reloaded = await enrichCommentsFromLocalProfiles(reload.comments);
      }
    }

    const currentScope = commentCacheKey(cleanPostId);
    if (currentScope.key !== sendScope.key) {
      console.log("KRISTO_COMMENTS_STALE_USER_IGNORED", {
        postId: cleanPostId,
        viewerUserId: sendScope.viewerUserId,
        stage: "post-send-merge",
      });
      return;
    }

    setComments((prev) =>
      mergeCommentsAfterSuccessfulPost(prev, optimistic.id, result.comment, reloaded)
    );

    if (typeof result.discussionCount === "number" && result.discussionCount >= 0) {
      onDiscussionCountChange(cleanPostId, result.discussionCount);
    } else if (result.returnedCount > 0) {
      onDiscussionCountChange(cleanPostId, result.returnedCount);
    }

    setReplyTo(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [
    postId,
    draft,
    replyTo,
    ensureMembership,
    onDiscussionCountChange,
    onDiscussionCountBump,
  ]);

  const handleReply = useCallback((comment: FeedCommentNode) => {
    const display = resolveCommentAuthor(comment);
    const prefix = mentionPrefixForAuthor(display.authorName);
    setReplyTo(comment);
    setDraft(prefix);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const clearReplyMode = useCallback(() => {
    setReplyTo(null);
    setDraft("");
  }, []);

  const replyDisplayName = useMemo(() => {
    if (!replyTo) return "";
    return resolveCommentAuthor(replyTo).authorName;
  }, [replyTo]);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={onClose}
        presentationStyle="fullScreen"
        statusBarTranslucent
      >
        <View style={styles.modalRoot}>
          <KeyboardAvoidingView
            style={styles.keyboardWrap}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={0}
            enabled
          >
            <View style={[styles.sheet, { paddingTop: Math.max(insets.top, 10) }]}>
              <View style={styles.headerRow}>
                <Text style={styles.title}>Comments</Text>
                <Pressable onPress={onClose} hitSlop={10}>
                  <Ionicons name="close" size={26} color="rgba(255,255,255,0.9)" />
                </Pressable>
              </View>

              <ScrollView
                style={styles.list}
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: LIST_BOTTOM_PADDING },
                ]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              >
                {loading || !initialLoadDone ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={HOME_FEED_GOLD_SOFT} />
                    <Text style={styles.loadingText}>Loading comments...</Text>
                  </View>
                ) : comments.length ? (
                  comments.map((comment) => (
                    <CommentRow
                      key={comment.id}
                      comment={comment}
                      onReply={handleReply}
                      onToggleLike={handleToggleLike}
                      onReport={handleReportComment}
                    />
                  ))
                ) : railDiscussionCount > 0 ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={HOME_FEED_GOLD_SOFT} />
                    <Text style={styles.loadingText}>Loading comments...</Text>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>No comments yet. Start the conversation.</Text>
                )}
              </ScrollView>

              <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
                {replyTo ? (
                  <View style={styles.replyBanner}>
                    <Text style={styles.replyBannerText} numberOfLines={1}>
                      Replying to {replyDisplayName}
                    </Text>
                    <Pressable onPress={clearReplyMode} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={HOME_FEED_MUTED} />
                    </Pressable>
                  </View>
                ) : null}

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <View style={styles.inputRow}>
                  <TextInput
                    ref={inputRef}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
                    placeholderTextColor="rgba(255,255,255,0.42)"
                    style={styles.input}
                    multiline
                    maxLength={5000}
                    editable={!sending}
                  />
                  <Pressable
                    style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
                    disabled={!draft.trim() || sending}
                    onPress={handleSend}
                  >
                    {sending ? (
                      <ActivityIndicator color="#0B0F17" size="small" />
                    ) : (
                      <Ionicons name="send" size={20} color="#0B0F17" />
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <CommentReportModal
        visible={Boolean(reportCommentId)}
        postId={postId}
        comment={findReportedComment(
          comments,
          reportCommentId
        )}
        onClose={() =>
          setReportCommentId("")
        }
      />
    </>
  );
});

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  keyboardWrap: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    backgroundColor: "#0B0F17",
    paddingHorizontal: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    marginBottom: 4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: 8,
    flexGrow: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: 10,
    backgroundColor: "#0B0F17",
    gap: 8,
  },
  loadingRow: {
    paddingVertical: 28,
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyText: {
    color: HOME_FEED_MUTED,
    textAlign: "center",
    paddingVertical: 28,
    fontSize: 14,
    fontWeight: "600",
  },
  avatarSlot: {
    flexShrink: 0,
    overflow: "visible",
  },
  avatarImage: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 2,
    borderColor: "rgba(217,179,95,0.55)",
  },
  avatarRing: {
    borderWidth: 2,
    borderColor: "rgba(217,179,95,0.55)",
  },
  commentCard: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
  },
  commentContent: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
    gap: 8,
  },
  commentName: {
    flexShrink: 1,
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 16,
    fontWeight: "800",
  },
  replyName: {
    flexShrink: 1,
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 15,
    fontWeight: "800",
  },
  timeText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "400",
    flexShrink: 0,
  },
  commentText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 21,
  },
  replyText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
  },
  seeMoreText: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  commentActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 18,
    marginTop: 12,
  },
  likeText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "800",
  },
  likeTextActive: {
    color: "#FF5A7A",
  },
  replyBtn: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 13,
    fontWeight: "800",
  },
  reportCommentBtn: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "700",
  },
  repliesWrap: {
    marginTop: 10,
  },
  repliesToggle: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
  },
  replyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  replyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 8,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,16,24,0.95)",
  },
  avatarInitial: {
    color: HOME_FEED_GOLD_SOFT,
    fontWeight: "900",
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(217,179,95,0.1)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  replyBannerText: {
    flex: 1,
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 12,
    fontWeight: "800",
    marginRight: 8,
  },
  errorText: {
    color: "#FF7A93",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: HOME_FEED_BG,
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top",
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: HOME_FEED_GOLD_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginBottom: 12,
  },
  reportBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  reportSheet: {
    backgroundColor: "#0B0F17",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  reportSubtitle: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  reportReadyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  reportReadyText: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
  submitBtn: {
    backgroundColor: HOME_FEED_GOLD_SOFT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnText: {
    color: "#0B0F17",
    fontSize: 15,
    fontWeight: "900",
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelBtnText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "700",
  },
});
