import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  checkAccountDeleteSubscription,
  getAccountDeleteStoreManagementFallbackMessage,
  hasDeleteAccountStoreSubscriptionConcern,
  isDeleteAccountStoreCancellationComplete,
  openAccountDeleteSubscriptionManagement,
  type AccountDeleteSubscriptionCheck,
} from "@/src/lib/accountDeleteSubscription";
import {
  DeleteAccountFinalConfirmModal,
  DeleteAccountSubscriptionChoiceModal,
  type DeleteAccountChoiceOption,
  type DeleteAccountFinalConfirmVariant,
} from "@/src/components/account/DeleteAccountSubscriptionModals";
import { apiPost } from "@/src/lib/kristoApi";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";

const BG = "#050914";
const GOLD = "#F4D06F";
const MUTED = "rgba(255,255,255,0.66)";
const BORDER = "rgba(244,208,111,0.24)";
const DANGER = "#FF5A5F";

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, exitSessionFast } = useKristoSession();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [choiceModalOpen, setChoiceModalOpen] = useState(false);
  const [finalConfirmOpen, setFinalConfirmOpen] = useState(false);
  const [finalConfirmVariant, setFinalConfirmVariant] =
    useState<DeleteAccountFinalConfirmVariant>("standard");
  const [deleting, setDeleting] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [processingOption, setProcessingOption] = useState<DeleteAccountChoiceOption | null>(
    null
  );
  const [inlineStatusMessage, setInlineStatusMessage] = useState<string | null>(null);
  const [subscriptionCheck, setSubscriptionCheck] = useState<AccountDeleteSubscriptionCheck | null>(
    null
  );
  const pendingCancelSubAfterManagementRef = useRef(false);
  const deleteContextRef = useRef({
    userId: "",
    role: "Member",
    churchId: "",
  });

  const flowBusy = deleting || checkingSubscription || Boolean(processingOption);

  function onChangePassword() {
    Alert.alert(
      "Change password",
      "Sign out, then on the login screen tap Forgot password? and reset your password using your account email.",
      [{ text: "OK" }]
    );
  }

  function onLogoutPress() {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          try {
            exitSessionFast({ reason: "logout" });
            router.replace("/(auth)/login" as any);
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  }

  const performAccountDelete = useCallback(async () => {
    if (deleting) return;

    const userId = deleteContextRef.current.userId;
    const role = deleteContextRef.current.role;
    const churchId = deleteContextRef.current.churchId;

    if (!userId) {
      Alert.alert(
        "Delete failed",
        "We could not delete your account. Please try again."
      );
      return;
    }

    setDeleting(true);
    console.log("KRISTO_DELETE_ACCOUNT_CONFIRM", { userId });

    const endpoint = "/api/auth/delete-account";

    try {
      const data = await apiPost(
        endpoint,
        {},
        getKristoHeaders({
          userId,
          role: role as any,
          churchId,
        })
      );

      if (!data?.ok) {
        console.log("KRISTO_DELETE_ACCOUNT_FAILED", {
          status: data?.status ?? null,
          message: String(data?.error || data?.reason || "unknown"),
          responseBody: data,
          userId,
          endpoint,
        });
        Alert.alert(
          "Delete failed",
          "We could not delete your account. Please try again."
        );
        return;
      }

      console.log("KRISTO_DELETE_ACCOUNT_SUCCESS", { userId });
      setDeleteModalOpen(false);
      setChoiceModalOpen(false);
      setFinalConfirmOpen(false);
      exitSessionFast({ reason: "delete", userId, churchId });
      console.log("KRISTO_DELETE_ACCOUNT_NAVIGATE_LOGIN", { userId });
      router.replace("/(auth)/login" as any);
    } catch (error: any) {
      console.log("KRISTO_DELETE_ACCOUNT_FAILED", {
        status: null,
        message: String(error?.message || error || "unknown"),
        responseBody: error,
        userId,
        endpoint,
      });
      Alert.alert(
        "Delete failed",
        "We could not delete your account. Please try again."
      );
    } finally {
      setDeleting(false);
    }
  }, [deleting, exitSessionFast, router]);

  const openFinalConfirm = useCallback((variant: DeleteAccountFinalConfirmVariant) => {
    setChoiceModalOpen(false);
    setInlineStatusMessage(null);
    setProcessingOption(null);
    setFinalConfirmVariant(variant);
    setFinalConfirmOpen(true);
  }, []);

  const runSubscriptionCheck = useCallback(async () => {
    const { userId, role, churchId } = deleteContextRef.current;
    if (!userId) {
      throw new Error("missing_user_id");
    }

    return checkAccountDeleteSubscription({
      churchId,
      headers: getKristoHeaders({
        userId,
        role: role as any,
        churchId,
      }) as Record<string, string>,
    });
  }, []);

  const handleSubscriptionCheckResult = useCallback(
    (check: AccountDeleteSubscriptionCheck) => {
      setSubscriptionCheck(check);

      if (hasDeleteAccountStoreSubscriptionConcern(check)) {
        setChoiceModalOpen(true);
        return;
      }

      openFinalConfirm("standard");
    },
    [openFinalConfirm]
  );

  const handleResumeAfterSubscriptionManagement = useCallback(async () => {
    const { userId, churchId } = deleteContextRef.current;
    if (!userId || !pendingCancelSubAfterManagementRef.current) return;

    pendingCancelSubAfterManagementRef.current = false;
    setCheckingSubscription(true);
    try {
      const check = await runSubscriptionCheck();
      setSubscriptionCheck(check);
      setProcessingOption(null);

      if (isDeleteAccountStoreCancellationComplete(check)) {
        setInlineStatusMessage(null);
        openFinalConfirm("after_cancel_subscription");
        return;
      }

      setChoiceModalOpen(true);
      setInlineStatusMessage(
        "Auto-renew is still enabled on this device. Turn off renewal in the store subscription screen, then choose Delete Account + Cancel Subscription again."
      );
    } catch (error: any) {
      console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_CHECK_FAILED", {
        userId,
        churchId: churchId || null,
        message: String(error?.message || error || "unknown"),
        phase: "app_resume_after_management",
      });
      setChoiceModalOpen(true);
      setInlineStatusMessage(
        "We could not refresh your subscription status. Try again in a moment."
      );
    } finally {
      setCheckingSubscription(false);
    }
  }, [handleSubscriptionCheckResult, openFinalConfirm, runSubscriptionCheck]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active" || !pendingCancelSubAfterManagementRef.current) return;
      void handleResumeAfterSubscriptionManagement();
    });

    return () => subscription.remove();
  }, [handleResumeAfterSubscriptionManagement]);

  const handleDeleteOnlyOption = useCallback(() => {
    setProcessingOption("delete_only");
    setInlineStatusMessage(null);
    openFinalConfirm("delete_only");
  }, [openFinalConfirm]);

  const handleCancelSubscriptionOption = useCallback(async () => {
    const check = subscriptionCheck;
    if (!check) return;

    setProcessingOption("cancel_subscription");
    setInlineStatusMessage(null);

    if (isDeleteAccountStoreCancellationComplete(check)) {
      setProcessingOption(null);
      openFinalConfirm("after_cancel_subscription");
      return;
    }

    pendingCancelSubAfterManagementRef.current = true;
    const result = await openAccountDeleteSubscriptionManagement(check);
    if (!result.opened) {
      pendingCancelSubAfterManagementRef.current = false;
      setProcessingOption(null);
      setChoiceModalOpen(true);
      setInlineStatusMessage(getAccountDeleteStoreManagementFallbackMessage());
    }
  }, [openFinalConfirm, subscriptionCheck]);

  const handleChoiceOption = useCallback(
    (option: DeleteAccountChoiceOption) => {
      if (flowBusy) return;
      if (option === "delete_only") {
        handleDeleteOnlyOption();
        return;
      }
      void handleCancelSubscriptionOption();
    },
    [flowBusy, handleCancelSubscriptionOption, handleDeleteOnlyOption]
  );

  const closeDeleteFlow = useCallback(() => {
    if (flowBusy) return;
    setDeleteModalOpen(false);
    setChoiceModalOpen(false);
    setFinalConfirmOpen(false);
    setInlineStatusMessage(null);
    setProcessingOption(null);
    pendingCancelSubAfterManagementRef.current = false;
  }, [flowBusy]);

  async function onConfirmDeleteAccount() {
    if (flowBusy) return;

    const userId = String(session?.userId || getKristoAuth().userId || "").trim();
    const role = String(session?.role || session?.churchRole || getKristoAuth().role || "Member");
    const churchId = String(session?.churchId || getKristoAuth().churchId || "").trim();

    if (!userId) {
      Alert.alert(
        "Delete failed",
        "We could not delete your account. Please try again."
      );
      return;
    }

    deleteContextRef.current = { userId, role, churchId };

    setCheckingSubscription(true);
    try {
      const check = await runSubscriptionCheck();
      setDeleteModalOpen(false);
      await handleSubscriptionCheckResult(check);
    } catch (error: any) {
      console.log("KRISTO_ACCOUNT_DELETE_SUBSCRIPTION_CHECK_FAILED", {
        userId,
        churchId: churchId || null,
        message: String(error?.message || error || "unknown"),
      });
      Alert.alert(
        "Delete failed",
        "We could not verify your subscription status. Please try again."
      );
    } finally {
      setCheckingSubscription(false);
    }
  }

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom, 24) + 24,
          paddingHorizontal: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={s.title}>Settings</Text>
          <View style={s.backBtnSpacer} />
        </View>

        <Text style={s.sectionLabel}>Account</Text>
        <View style={s.sectionCard}>
          <Pressable onPress={onChangePassword} style={({ pressed }) => [s.rowBtn, pressed && s.pressed]}>
            <Ionicons name="key-outline" size={20} color={GOLD} />
            <Text style={s.rowText}>Change Password</Text>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
          </Pressable>

          <View style={s.rowDivider} />

          <Pressable
            onPress={() => setDeleteModalOpen(true)}
            disabled={flowBusy}
            style={({ pressed }) => [
              s.rowBtn,
              pressed && s.pressed,
              flowBusy && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="trash-outline" size={20} color={DANGER} />
            <Text style={[s.rowText, s.rowTextDanger]}>Delete Account</Text>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,90,95,0.55)" />
          </Pressable>
        </View>

        <Text style={s.sectionLabel}>Session</Text>
        <View style={s.sectionCard}>
          <Pressable
            onPress={onLogoutPress}
            disabled={loggingOut}
            style={({ pressed }) => [s.rowBtn, pressed && s.pressed, loggingOut && { opacity: 0.5 }]}
          >
            <Ionicons name="log-out-outline" size={20} color={DANGER} />
            <Text style={s.rowText}>Logout</Text>
            {loggingOut ? (
              <ActivityIndicator size="small" color={DANGER} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
            )}
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={deleteModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!flowBusy) setDeleteModalOpen(false);
        }}
      >
        <View style={s.modalWrap}>
          <Pressable
            style={s.modalBackdrop}
            onPress={() => {
              if (!flowBusy) setDeleteModalOpen(false);
            }}
          />
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Delete Account?</Text>
            <Text style={s.modalMessage}>
              This will permanently delete your Kristo account and sign you out. Active App Store or
              Google Play subscriptions must be cancelled separately to stop renewal charges.
            </Text>

            <View style={s.modalActions}>
              <Pressable
                onPress={() => setDeleteModalOpen(false)}
                disabled={flowBusy}
                style={({ pressed }) => [
                  s.modalNotNowBtn,
                  pressed && !flowBusy && s.pressed,
                  flowBusy && { opacity: 0.45 },
                ]}
              >
                <Text style={s.modalNotNowText}>Not Now</Text>
              </Pressable>

              <Pressable
                onPress={onConfirmDeleteAccount}
                disabled={flowBusy}
                style={({ pressed }) => [
                  s.modalDeleteBtn,
                  pressed && !flowBusy && s.pressed,
                  flowBusy && { opacity: 0.55 },
                ]}
              >
                {checkingSubscription ? (
                  <View style={s.modalDeleteLoading}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={s.modalDeleteText}>Checking...</Text>
                  </View>
                ) : (
                  <Text style={s.modalDeleteText}>Continue</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <DeleteAccountSubscriptionChoiceModal
        visible={choiceModalOpen}
        inlineStatusMessage={inlineStatusMessage}
        processingOption={processingOption}
        disabled={checkingSubscription || deleting}
        onSelectOption={handleChoiceOption}
        onNotNow={closeDeleteFlow}
      />

      <DeleteAccountFinalConfirmModal
        visible={finalConfirmOpen}
        variant={finalConfirmVariant}
        deleting={deleting}
        onConfirm={() => {
          void performAccountDelete();
        }}
        onNotNow={closeDeleteFlow}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  backBtnSpacer: { width: 42 },
  title: { color: "#fff", fontSize: 22, fontWeight: "900" },
  sectionLabel: {
    color: MUTED,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 18,
    overflow: "hidden",
  },
  rowBtn: {
    minHeight: 54,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: { flex: 1, color: "#fff", fontWeight: "800", fontSize: 16 },
  rowTextDanger: { color: "#FFB4B8" },
  rowDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginHorizontal: 14 },
  pressed: { opacity: 0.82 },
  modalWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  modalBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  modalCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#0B0F17",
    borderWidth: 1.2,
    borderColor: "rgba(255,90,95,0.45)",
  },
  modalTitle: { color: "#fff", fontWeight: "900", fontSize: 20 },
  modalMessage: {
    color: MUTED,
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalNotNowBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  modalNotNowText: { color: "#fff", fontWeight: "900" },
  modalDeleteBtn: {
    flex: 1.2,
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,90,95,0.92)",
  },
  modalDeleteText: { color: "#fff", fontWeight: "900" },
  modalDeleteLoading: { flexDirection: "row", alignItems: "center", gap: 8 },
});
