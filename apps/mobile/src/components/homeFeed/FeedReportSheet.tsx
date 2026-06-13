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
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  postId: string;
  onClose: () => void;
  onReported: (postId: string) => void;
};

export const FeedReportSheet = memo(function FeedReportSheet({
  visible,
  postId,
  onClose,
  onReported,
}: Props) {
  const insets = useSafeAreaInsets();
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [selectedReason, setSelectedReason] = useState<HomeFeedReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");

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

    const result = await submitHomeFeedReport({
      postId,
      reason: selectedReason,
      details,
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
    onReported,
    onClose,
  ]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardWrap}
        >
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />

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
              <ScrollView style={styles.reasonList} showsVerticalScrollIndicator={false}>
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
              </ScrollView>
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
    paddingHorizontal: 18,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: "82%",
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
    maxHeight: 280,
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
    marginTop: 4,
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
