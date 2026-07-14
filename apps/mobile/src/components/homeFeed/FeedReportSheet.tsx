import React, { memo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import {
  HOME_FEED_REPORT_REASONS,
  type HomeFeedReportReason,
  fetchPostReportStatus,
  submitHomeFeedReport,
} from "@/src/lib/homeFeedReport";
import { blockHomeFeedUser } from "@/src/lib/homeFeedModeration";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  fileNameFromUri,
  guessPosterContentType,
  resolveUploadFileSize,
  uploadPosterToStorageWithRetry,
} from "@/src/lib/churchVideoUpload";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  postId: string;
  authorUserId?: string;
  targetItem?: any;
  onClose: () => void;
  onReported: (postId: string) => void;
  onBlocked?: (blockedUserId: string) => void;
};


function firstSafetyText(
  values: unknown[],
  maxLength: number
) {
  for (const value of values) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      return text.slice(0, maxLength);
    }
  }

  return "";
}

function firstSafetyUri(
  values: unknown[]
) {
  const normalizeImageUri = (
    value: unknown
  ) => {
    const uri =
      typeof value === "string"
        ? value.trim()
        : String(
            (value as any)?.uri ||
            (value as any)?.url ||
            (value as any)?.thumbnailUri ||
            (value as any)?.thumbnailUrl ||
            (value as any)?.posterUri ||
            (value as any)?.posterUrl ||
            ""
          ).trim();

    if (!uri) {
      return "";
    }

    /*
     * Internal values such as
     * `kristo:branded-poster` are markers,
     * not image URLs. Sending them into
     * React Native Image crashes iOS.
     */
    const supported =
      /^https?:\/\//i.test(uri) ||
      /^file:\/\//i.test(uri) ||
      /^content:\/\//i.test(uri) ||
      /^data:image\//i.test(uri) ||
      /^ph:\/\//i.test(uri) ||
      /^assets-library:\/\//i.test(uri);

    if (!supported) {
      console.log(
        "KRISTO_SAFETY_THUMBNAIL_SKIPPED",
        {
          scheme:
            uri.includes(":")
              ? uri.split(":")[0]
              : "none",
        }
      );

      return "";
    }

    return uri.slice(0, 4000);
  };

  for (const value of values) {
    const entries =
      Array.isArray(value)
        ? value
        : [value];

    for (const entry of entries) {
      const uri =
        normalizeImageUri(entry);

      if (uri) {
        return uri;
      }
    }
  }

  return "";
}

function isHttpsSafetyThumbnail(
  value: unknown
) {
  return /^https:\/\//i.test(
    String(value || "").trim()
  );
}

function isLocalSafetyThumbnail(
  value: unknown
) {
  const uri =
    String(value || "").trim();

  return (
    /^file:\/\//i.test(uri) ||
    /^content:\/\//i.test(uri) ||
    /^ph:\/\//i.test(uri) ||
    /^assets-library:\/\//i.test(uri)
  );
}

async function prepareSafetyThumbnailForReport(
  input: {
    thumbnailUri: string;
    postId: string;
  }
) {
  const thumbnailUri =
    String(input.thumbnailUri || "").trim();

  if (!thumbnailUri) {
    return "";
  }

  if (isHttpsSafetyThumbnail(thumbnailUri)) {
    console.log(
      "KRISTO_SAFETY_THUMBNAIL_REMOTE_REUSED",
      {
        postId: input.postId,
      }
    );

    return thumbnailUri;
  }

  if (!isLocalSafetyThumbnail(thumbnailUri)) {
    console.log(
      "KRISTO_SAFETY_THUMBNAIL_OMITTED",
      {
        postId: input.postId,
        reason: "unsupported_uri",
        scheme:
          thumbnailUri.includes(":")
            ? thumbnailUri.split(":")[0]
            : "none",
      }
    );

    return "";
  }

  try {
    const fileSize =
      await resolveUploadFileSize(
        thumbnailUri
      );

    if (
      !Number.isFinite(fileSize) ||
      fileSize <= 0
    ) {
      console.log(
        "KRISTO_SAFETY_THUMBNAIL_UPLOAD_SKIPPED",
        {
          postId: input.postId,
          reason: "empty_file",
        }
      );

      return "";
    }

    const fileName =
      fileNameFromUri(
        thumbnailUri,
        `safety-report-${input.postId}-${Date.now()}.jpg`
      );

    const contentType =
      guessPosterContentType(fileName);

    console.log(
      "KRISTO_SAFETY_THUMBNAIL_UPLOAD_START",
      {
        postId: input.postId,
        fileSize,
        contentType,
      }
    );

    const uploaded =
      await uploadPosterToStorageWithRetry({
        fileUri: thumbnailUri,
        fileName,
        contentType,
        fileSize,
        headers: getKristoHeaders(),
      });

    const remoteUri =
      String(
        uploaded?.publicUrl ||
        uploaded?.videoUrl ||
        ""
      ).trim();

    if (!isHttpsSafetyThumbnail(remoteUri)) {
      console.log(
        "KRISTO_SAFETY_THUMBNAIL_UPLOAD_FAILED",
        {
          postId: input.postId,
          reason: "non_https_result",
        }
      );

      return "";
    }

    console.log(
      "KRISTO_SAFETY_THUMBNAIL_UPLOAD_OK",
      {
        postId: input.postId,
        remoteUri:
          remoteUri.slice(0, 180),
      }
    );

    return remoteUri;
  } catch (error) {
    /*
     * Evidence upload must never prevent
     * the safety report itself from being
     * submitted.
     */
    console.log(
      "KRISTO_SAFETY_THUMBNAIL_UPLOAD_FAILED",
      {
        postId: input.postId,
        reason: "upload_error",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );

    return "";
  }
}

function buildFeedReportEvidence(
  item: any,
  fallbackAuthorUserId: string
) {
  const row =
    item &&
    typeof item === "object"
      ? item
      : {};

  const media =
    row?.media &&
    typeof row.media === "object"
      ? row.media
      : {};

  const ownerName = firstSafetyText(
    [
      row?.churchMediaName,
      row?.mediaName,
      row?.churchName,
      row?.authorName,
      row?.ownerName,
      row?.displayName,
      row?.createdByName,
      row?.publisherName,
      row?.profileName,
      row?.userName,
    ],
    240
  );

  const title = firstSafetyText(
    [
      row?.title,
      row?.headline,
      row?.videoTitle,
      row?.postTitle,
      row?.subject,
      row?.caption,
      ownerName,
    ],
    240
  );

  const preview = firstSafetyText(
    [
      row?.caption,
      row?.description,
      row?.body,
      row?.text,
      row?.message,
      row?.content,
      title,
    ],
    600
  );

  const ownerUserId = firstSafetyText(
    [
      row?.createdByUserId,
      row?.createdBy,
      row?.authorUserId,
      row?.ownerUserId,
      row?.creatorUserId,
      row?.userId,
      fallbackAuthorUserId,
    ],
    240
  );

  const thumbnailUri = firstSafetyUri(
    [
      row?.thumbnailUri,
      row?.thumbnailUrl,
      row?.posterUri,
      row?.posterUrl,
      row?.videoPosterUri,
      row?.videoPosterUrl,
      row?.coverUri,
      row?.coverUrl,
      row?.imageUri,
      row?.imageUrl,
      row?.mediaThumbnailUri,
      row?.mediaThumbnailUrl,
      row?.images,
      row?.imageUrls,
      row?.attachments,
      row?.media,
      media?.thumbnailUri,
      media?.thumbnailUrl,
      media?.posterUri,
      media?.posterUrl,
      media?.imageUri,
      media?.imageUrl,
    ]
  );

  const targetOwnerAvatarUri =
    firstSafetyUri(
      [
        row?.churchAvatarUri,
        row?.churchAvatarUrl,
        row?.churchLogoUri,
        row?.churchLogoUrl,
        row?.churchAvatar,
        row?.churchLogo,
        row?.churchImage,
        row?.churchPhoto,

        row?.mediaAvatarUri,
        row?.mediaAvatarUrl,
        row?.mediaLogoUri,
        row?.mediaLogoUrl,
        row?.mediaAvatar,
        row?.mediaLogo,

        row?.publisherAvatarUri,
        row?.publisherAvatarUrl,
        row?.publisherLogoUri,
        row?.publisherLogoUrl,

        row?.ownerAvatarUri,
        row?.ownerAvatarUrl,
        row?.ownerImageUri,
        row?.ownerImageUrl,

        row?.authorAvatarUri,
        row?.authorAvatarUrl,
        row?.authorAvatar,
        row?.authorImageUri,
        row?.authorImageUrl,

        /*
         * Canonical avatar fields used by the
         * Home Feed backend/card mapper.
         */
        row?.actorAvatarUri,
        row?.actorAvatarUrl,
        row?.actorAvatar,
        row?.profileAvatarUri,
        row?.profileAvatarUrl,
        row?.profileAvatar,

        row?.avatarUri,
        row?.avatarUrl,
        row?.avatar,
        row?.logoUri,
        row?.logoUrl,
        row?.logo,
        row?.profileImage,
        row?.profileImageUri,
        row?.profileImageUrl,
        row?.photoURL,
        row?.photoUrl,
        row?.image,

        row?.church?.avatarUri,
        row?.church?.avatarUrl,
        row?.church?.avatar,
        row?.church?.logoUri,
        row?.church?.logoUrl,
        row?.church?.logo,
        row?.church?.imageUri,
        row?.church?.imageUrl,

        row?.owner?.avatarUri,
        row?.owner?.avatarUrl,
        row?.owner?.profileImage,

        row?.author?.avatarUri,
        row?.author?.avatarUrl,
        row?.author?.profileImage,

        row?.actor?.avatarUri,
        row?.actor?.avatarUrl,
        row?.actor?.profileImage,

        row?.profile?.avatarUri,
        row?.profile?.avatarUrl,
        row?.profile?.profileImage,

        media?.avatarUri,
        media?.avatarUrl,
        media?.avatar,
        media?.logoUri,
        media?.logoUrl,
        media?.logo,
        media?.churchAvatarUri,
        media?.churchAvatarUrl,
        media?.churchLogoUri,
        media?.churchLogoUrl,
      ]
    );

  const rawMediaType =
    firstSafetyText(
      [
        row?.mediaType,
        row?.contentType,
        row?.postType,
        row?.type,
        media?.mediaType,
        media?.contentType,
        media?.type,
      ],
      40
    ).toLowerCase();

  const targetMediaType:
    | "video"
    | "image"
    | "audio"
    | "text" =
    rawMediaType.includes("video") ||
    Boolean(
      row?.videoUri ||
      row?.videoUrl ||
      media?.videoUri ||
      media?.videoUrl
    )
      ? "video"
      : rawMediaType.includes("audio") ||
          Boolean(
            row?.audioUri ||
            row?.audioUrl ||
            media?.audioUri ||
            media?.audioUrl
          )
        ? "audio"
        : rawMediaType.includes("image") ||
            Boolean(thumbnailUri)
          ? "image"
          : "text";

  /*
   * Context shown below the reported post title.
   * Prefer the church/media identity attached to the post.
   */
  const targetSubtitle = firstSafetyText(
    [
      row?.churchName,
      row?.churchDisplayName,
      row?.mediaName,
      row?.publisherName,
      row?.organizationName,
      row?.ministryName,
      row?.authorChurchName,
      row?.ownerChurchName,
      row?.church?.name,
      row?.church?.displayName,
      media?.churchName,
      media?.publisherName,
      ownerName,
    ],
    300
  );

  return {
    targetTitle:
      title ||
      ownerName ||
      "Reported post",

    targetSubtitle,

    targetOwnerName:
      ownerName,

    targetOwnerAvatarUri,

    targetMediaType,

    targetOwnerUserId:
      ownerUserId,

    targetPreview:
      preview,

    targetThumbnailUri:
      thumbnailUri,
  };
}

export const FeedReportSheet = memo(function FeedReportSheet({
  visible,
  postId,
  authorUserId = "",
  targetItem = null,
  onClose,
  onReported,
  onBlocked,
}: Props) {
  const insets = useSafeAreaInsets();
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [selectedReason, setSelectedReason] = useState<HomeFeedReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    console.log("KRISTO_REPORT_SHEET_VISIBLE", {
      visible,
      postId,
    });
  }, [visible, postId]);

  const resetForm = useCallback(() => {
    setSelectedReason(null);
    setDetails("");
    setError("");
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!visible || !postId) return;

    console.log("KRISTO_REPORT_OPEN", { postId });
    resetForm();
    setLoadingStatus(true);

    void fetchPostReportStatus(postId)
      .then((status) => {
        setAlreadyReported(status.alreadyReported);
      })
      .finally(() => {
        setLoadingStatus(false);
      });
  }, [visible, postId, resetForm]);

  const handleSubmit = useCallback(async () => {
    if (!postId || alreadyReported || submitting) return;
    if (!selectedReason) {
      setError("Select a reason to continue.");
      return;
    }

    setError("");
    setSubmitting(true);

    const evidence =
      buildFeedReportEvidence(
        targetItem,
        authorUserId
      );

    const remoteThumbnailUri =
      await prepareSafetyThumbnailForReport({
        thumbnailUri:
          evidence.targetThumbnailUri,
        postId,
      });

    const result =
      await submitHomeFeedReport({
          postId,
          reason: selectedReason,
          details,

          targetType: "post",
          targetId: postId,

          targetTitle:
            evidence.targetTitle,

          targetSubtitle:
            evidence.targetSubtitle,

          targetOwnerName:
            evidence.targetOwnerName,

          targetOwnerAvatarUri:
            evidence.targetOwnerAvatarUri,

          targetMediaType:
            evidence.targetMediaType,

          targetOwnerUserId:
            evidence.targetOwnerUserId,

          targetPreview:
            evidence.targetPreview,

        targetThumbnailUri:
          remoteThumbnailUri || undefined,
        });

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setAlreadyReported(true);
    onReported(postId);
    onClose();
  }, [
    postId,
    alreadyReported,
    submitting,
    selectedReason,
    details,
    targetItem,
    authorUserId,
    onReported,
    onClose,
  ]);

  const handleBlockUser = useCallback(async () => {
    const targetUserId = String(authorUserId || "").trim();
    if (!targetUserId || blocking) return;
    setBlocking(true);
    setError("");
    const result = await blockHomeFeedUser({
      blockedUserId: targetUserId,
      reason: "User blocked from Home Feed",
    });
    setBlocking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onBlocked?.(targetUserId);
    onClose();
  }, [authorUserId, blocking, onBlocked, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardWrap}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              <Text style={styles.title}>Report post</Text>
              <Text style={styles.subtitle}>
                Help us review content that violates community standards.
              </Text>

              {loadingStatus ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={HOME_FEED_GOLD_SOFT} />
                </View>
              ) : alreadyReported ? (
                <View style={styles.alreadyBox}>
                  <Ionicons name="checkmark-circle" size={22} color={HOME_FEED_GOLD_SOFT} />
                  <Text style={styles.alreadyText}>Already reported</Text>
                </View>
              ) : (
                <View style={styles.reasonList}>
                  {HOME_FEED_REPORT_REASONS.map((reason) => {
                    const active = selectedReason === reason;
                    return (
                      <Pressable
                        key={reason}
                        style={[styles.reasonRow, active ? styles.reasonRowActive : null]}
                        onPress={() => {
                          setSelectedReason(reason);
                          setError("");
                        }}
                      >
                        <View style={[styles.radio, active ? styles.radioActive : null]}>
                          {active ? <View style={styles.radioDot} /> : null}
                        </View>
                        <Text style={[styles.reasonText, active ? styles.reasonTextActive : null]}>
                          {reason}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {!alreadyReported && !loadingStatus ? (
                <TextInput
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Optional details"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.detailsInput}
                  multiline
                  maxLength={2000}
                  editable={!submitting}
                />
              ) : null}

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
              {authorUserId ? (
                <Pressable
                  style={[styles.blockBtn, blocking ? styles.submitBtnDisabled : null]}
                  disabled={blocking}
                  onPress={handleBlockUser}
                >
                  {blocking ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.blockBtnText}>Block user</Text>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                style={[
                  styles.submitBtn,
                  alreadyReported || submitting || loadingStatus ? styles.submitBtnDisabled : null,
                ]}
                disabled={alreadyReported || submitting || loadingStatus}
                onPress={handleSubmit}
              >
                {submitting ? (
                  <ActivityIndicator color="#0B0F17" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {alreadyReported ? "Already reported" : "Submit report"}
                  </Text>
                )}
              </Pressable>

              <Pressable style={styles.cancelBtn} onPress={onClose} hitSlop={10}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  keyboardWrap: {
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0B0F17",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: "82%",
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginBottom: 14,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  subtitle: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  loadingRow: {
    paddingVertical: 28,
    alignItems: "center",
  },
  alreadyBox: {
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
  alreadyText: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 15,
    fontWeight: "800",
  },
  reasonList: {
    marginBottom: 10,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  reasonRowActive: {
    backgroundColor: "rgba(217,179,95,0.1)",
    borderColor: "rgba(217,179,95,0.4)",
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: {
    borderColor: HOME_FEED_GOLD_SOFT,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: HOME_FEED_GOLD_SOFT,
  },
  reasonText: {
    flex: 1,
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    fontWeight: "600",
  },
  reasonTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  detailsInput: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: HOME_FEED_BG,
    color: "#FFFFFF",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
    marginBottom: 10,
  },
  errorText: {
    color: "#FF7A93",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  submitBtn: {
    backgroundColor: HOME_FEED_GOLD_SOFT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  blockBtn: {
    backgroundColor: "rgba(255,107,107,0.24)",
    borderColor: "rgba(255,107,107,0.48)",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  blockBtnText: {
    color: "#FFD0D0",
    fontSize: 14,
    fontWeight: "900",
  },
  submitBtnDisabled: {
    opacity: 0.55,
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
