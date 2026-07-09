import React, { memo, useCallback, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  HOME_FEED_REPORT_REASONS,
  type HomeFeedReportReason,
  submitChurchReport,
} from "@/src/lib/churchFeedReport";

type Props = {
  visible: boolean;
  churchId: string;
  churchName?: string;
  onClose: () => void;
  onReported?: () => void;
};

export const ChurchReportSheet = memo(function ChurchReportSheet({
  visible,
  churchId,
  churchName = "",
  onClose,
  onReported,
}: Props) {
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);
  const [selectedReason, setSelectedReason] = useState<HomeFeedReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const resetForm = useCallback(() => {
    setSelectedReason(null);
    setDetails("");
    setError("");
    setSubmitting(false);
    setSubmitted(false);
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    resetForm();
  }, [visible, churchId, resetForm]);

  const handleSubmit = useCallback(async () => {
    if (!churchId || submitting || submitted) return;
    if (!selectedReason) {
      setError("Select a reason to continue.");
      return;
    }

    setError("");
    setSubmitting(true);
    const result = await submitChurchReport({
      churchId,
      reason: selectedReason,
      details,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSubmitted(true);
    onReported?.();
    onClose();
  }, [churchId, submitting, submitted, selectedReason, details, onReported, onClose]);

  const label = churchName.trim() || churchId;

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
              <Text style={styles.title}>Report church</Text>
              <Text style={styles.subtitle}>
                Report {label} for review. Reporting does not automatically block this church.
              </Text>

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

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
              <Pressable
                style={[styles.submitBtn, submitting ? styles.submitBtnDisabled : null]}
                disabled={submitting}
                onPress={handleSubmit}
              >
                {submitting ? (
                  <ActivityIndicator color="#0B0F17" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit report</Text>
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
  keyboardWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#0B0F17",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: "82%",
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 12 },
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
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  reasonList: { gap: 8 },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  reasonRowActive: {
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.1)",
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { borderColor: "#D9B35F" },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D9B35F",
  },
  reasonText: { flex: 1, color: "rgba(255,255,255,0.78)", fontWeight: "700", fontSize: 14 },
  reasonTextActive: { color: "#FFFFFF" },
  detailsInput: {
    marginTop: 12,
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
    fontWeight: "600",
  },
  errorText: { color: "#ff7b7b", marginTop: 10, fontWeight: "700", fontSize: 13 },
  submitBtn: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D9B35F",
  },
  submitBtnDisabled: { opacity: 0.55 },
  submitBtnText: { color: "#0B0F17", fontWeight: "900", fontSize: 15 },
  cancelBtn: { marginTop: 10, alignItems: "center", paddingVertical: 8 },
  cancelBtnText: { color: "rgba(255,255,255,0.72)", fontWeight: "800", fontSize: 14 },
});
