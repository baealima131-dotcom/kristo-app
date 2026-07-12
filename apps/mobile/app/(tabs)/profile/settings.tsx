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
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  checkAccountDeletePastorOwnership,
  checkAccountDeleteSubscription,
  getAccountDeleteStoreManagementFallbackMessage,
  isDeleteAccountStoreCancellationComplete,
  openAccountDeleteSubscriptionManagement,
  resolveAccountDeleteSubscriptionOwnerGate,
  type AccountDeletePastorOwnershipCheck,
  type AccountDeleteSubscriptionCheck,
} from "@/src/lib/accountDeleteSubscription";
import {
  DeleteAccountFinalConfirmModal,
  DeleteAccountLockHolderModal,
  DeleteAccountPastorOwnsChurchModal,
  DeleteAccountSubscriptionChoiceModal,
  type DeleteAccountChoiceOption,
  type DeleteAccountFinalConfirmVariant,
} from "@/src/components/account/DeleteAccountSubscriptionModals";
import {
  apiGet,
  apiPost,
} from "@/src/lib/kristoApi";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";

const BG = "#050914";
const GOLD = "#F4D06F";
const MUTED = "rgba(255,255,255,0.66)";
const BORDER = "rgba(244,208,111,0.24)";
const DANGER = "#FF5A5F";

type PersonalPrivacy = {
  showGender: boolean;
  showCountry: boolean;
  showCity: boolean;
  showMaritalStatus: boolean;
  showLanguages: boolean;
  showProfileFact: boolean;
  showMemberSince: boolean;
  showChurchHistory: boolean;
};

type PersonalProfileForm = {
  gender: "" | "MALE" | "FEMALE";
  dob: string;
  maritalStatus:
    | "SINGLE"
    | "MARRIED"
    | "DIVORCED"
    | "WIDOWED";
  country: string;
  city: string;
  languages: string;
  profileFact: string;
};

const DEFAULT_PERSONAL_PRIVACY: PersonalPrivacy = {
  showGender: false,
  showCountry: true,
  showCity: false,
  showMaritalStatus: false,
  showLanguages: true,
  showProfileFact: true,
  showMemberSince: true,
  showChurchHistory: false,
};

const EMPTY_PERSONAL_FORM: PersonalProfileForm = {
  gender: "",
  dob: "",
  maritalStatus: "SINGLE",
  country: "",
  city: "",
  languages: "",
  profileFact: "",
};

const GENDER_OPTIONS = [
  {
    value: "MALE",
    label: "Male",
    icon: "male-outline",
  },
  {
    value: "FEMALE",
    label: "Female",
    icon: "female-outline",
  },
] as const;

const MARITAL_OPTIONS = [
  {
    value: "SINGLE",
    label: "Single",
  },
  {
    value: "MARRIED",
    label: "Married",
  },
  {
    value: "DIVORCED",
    label: "Divorced",
  },
  {
    value: "WIDOWED",
    label: "Widowed",
  },
] as const;

function PrivacySettingRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon: React.ComponentProps<
    typeof Ionicons
  >["name"];
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{
        checked: value,
      }}
      style={({ pressed }) => [
        s.privacyRow,
        pressed && s.pressed,
      ]}
    >
      <View
        style={[
          s.privacyRowIcon,
          value &&
            s.privacyRowIconActive,
        ]}
      >
        <Ionicons
          name={icon}
          size={19}
          color={
            value
              ? GOLD
              : "rgba(255,255,255,0.56)"
          }
        />
      </View>

      <View style={s.privacyRowCopy}>
        <Text style={s.privacyRowTitle}>
          {title}
        </Text>

        <Text style={s.privacyRowSub}>
          {subtitle}
        </Text>
      </View>

      <View
        style={[
          s.toggleTrack,
          value && s.toggleTrackActive,
        ]}
      >
        <View
          style={[
            s.toggleKnob,
            value && s.toggleKnobActive,
          ]}
        />
      </View>
    </Pressable>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, exitSessionFast } = useKristoSession();

  const [personalForm, setPersonalForm] =
    useState<PersonalProfileForm>(
      EMPTY_PERSONAL_FORM
    );

  const [personalPrivacy, setPersonalPrivacy] =
    useState<PersonalPrivacy>(
      DEFAULT_PERSONAL_PRIVACY
    );

  const [dobPublic, setDobPublic] =
    useState(false);

  const [loadingPersonalInfo, setLoadingPersonalInfo] =
    useState(true);

  const [savingPersonalInfo, setSavingPersonalInfo] =
    useState(false);

  const [personalInfoLoaded, setPersonalInfoLoaded] =
    useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [choiceModalOpen, setChoiceModalOpen] = useState(false);
  const [lockHolderModalOpen, setLockHolderModalOpen] = useState(false);
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
  const [managingLockHolderSubscription, setManagingLockHolderSubscription] = useState(false);
  const [subscriptionCheck, setSubscriptionCheck] = useState<AccountDeleteSubscriptionCheck | null>(
    null
  );
  const [pastorOwnershipCheck, setPastorOwnershipCheck] =
    useState<AccountDeletePastorOwnershipCheck | null>(null);
  const [pastorOwnsChurchModalOpen, setPastorOwnsChurchModalOpen] = useState(false);
  const pendingCancelSubAfterManagementRef = useRef(false);
  const pendingLockHolderManageRef = useRef(false);
  const deleteContextRef = useRef({
    userId: "",
    role: "Member",
    churchId: "",
  });

  const flowBusy =
    deleting ||
    checkingSubscription ||
    Boolean(processingOption) ||
    managingLockHolderSubscription;

  useEffect(() => {
    let alive = true;

    async function loadPersonalInformation() {
      const userId = String(
        session?.userId ||
          getKristoAuth().userId ||
          ""
      ).trim();

      if (!userId) {
        if (alive) {
          setLoadingPersonalInfo(false);
        }
        return;
      }

      try {
        setLoadingPersonalInfo(true);

        const response: any =
          await apiGet(
            "/api/auth/profile",
            {
              headers: getKristoHeaders({
                userId,
                role:
                  (session?.role ||
                    session?.churchRole ||
                    "Member") as any,
                churchId: String(
                  session?.churchId || ""
                ).trim(),
              }),
            },
            {
              screen:
                "ProfilePersonalSettings",
              throttleMs: 0,
            }
          );

        if (
          !alive ||
          !response?.ok ||
          !response?.profile
        ) {
          return;
        }

        const profile = response.profile;
        const privacy =
          profile.privacy &&
          typeof profile.privacy === "object"
            ? profile.privacy
            : {};

        setPersonalForm({
          gender:
            profile.gender === "MALE" ||
            profile.gender === "FEMALE"
              ? profile.gender
              : "",

          dob: String(
            profile.dob || ""
          ).trim(),

          maritalStatus:
            profile.maritalStatus ===
              "MARRIED" ||
            profile.maritalStatus ===
              "DIVORCED" ||
            profile.maritalStatus ===
              "WIDOWED"
              ? profile.maritalStatus
              : "SINGLE",

          country: String(
            profile.country || ""
          ).trim(),

          city: String(
            profile.city || ""
          ).trim(),

          languages: Array.isArray(
            profile.languages
          )
            ? profile.languages
                .map((value: unknown) =>
                  String(value || "").trim()
                )
                .filter(Boolean)
                .join(", ")
            : String(
                profile.languages || ""
              ).trim(),

          profileFact: String(
            profile.profileFact ||
              profile.bio ||
              ""
          )
            .trim()
            .slice(0, 160),
        });

        setDobPublic(
          profile.dobVisibility ===
            "Public"
        );

        setPersonalPrivacy({
          showGender:
            privacy.showGender === true,

          showCountry:
            "showCountry" in privacy
              ? privacy.showCountry === true
              : true,

          showCity:
            privacy.showCity === true,

          showMaritalStatus:
            privacy.showMaritalStatus ===
            true,

          showLanguages:
            "showLanguages" in privacy
              ? privacy.showLanguages === true
              : true,

          showProfileFact:
            "showProfileFact" in privacy
              ? privacy.showProfileFact === true
              : true,

          showMemberSince:
            "showMemberSince" in privacy
              ? privacy.showMemberSince === true
              : true,

          showChurchHistory:
            privacy.showChurchHistory ===
            true,
        });

        setPersonalInfoLoaded(true);

        console.log(
          "KRISTO_PERSONAL_SETTINGS_HYDRATED",
          {
            userId,
            hasGender: Boolean(
              profile.gender
            ),
            hasDob: Boolean(profile.dob),
            hasCountry: Boolean(
              profile.country
            ),
            hasLanguages:
              Array.isArray(
                profile.languages
              ) &&
              profile.languages.length > 0,
          }
        );
      } catch (error: any) {
        console.warn(
          "KRISTO_PERSONAL_SETTINGS_LOAD_FAILED",
          {
            message: String(
              error?.message ||
                error ||
                "unknown"
            ),
          }
        );
      } finally {
        if (alive) {
          setLoadingPersonalInfo(false);
        }
      }
    }

    void loadPersonalInformation();

    return () => {
      alive = false;
    };
  }, [
    session?.churchId,
    session?.churchRole,
    session?.role,
    session?.userId,
  ]);

  function updatePersonalField<
    K extends keyof PersonalProfileForm
  >(
    key: K,
    value: PersonalProfileForm[K]
  ) {
    setPersonalForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updatePersonalPrivacy(
    key: keyof PersonalPrivacy,
    value: boolean
  ) {
    setPersonalPrivacy((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function savePersonalInformation() {
    if (
      savingPersonalInfo ||
      loadingPersonalInfo
    ) {
      return;
    }

    const userId = String(
      session?.userId ||
        getKristoAuth().userId ||
        ""
    ).trim();

    if (!userId) {
      Alert.alert(
        "Save failed",
        "Your account could not be identified."
      );
      return;
    }

    const dob =
      personalForm.dob.trim();

    if (
      dob &&
      !/^\d{4}-\d{2}-\d{2}$/.test(dob)
    ) {
      Alert.alert(
        "Date of birth",
        "Enter the date using YYYY-MM-DD, for example 1995-08-24."
      );
      return;
    }

    const languages =
      personalForm.languages
        .split(",")
        .map((value) =>
          value.trim()
        )
        .filter(Boolean)
        .slice(0, 8);

    setSavingPersonalInfo(true);

    try {
      const response: any =
        await apiPost(
          "/api/auth/profile",
          {
            gender:
              personalForm.gender ||
              undefined,

            dob,

            dobVisibility:
              dobPublic
                ? "Public"
                : "Private",

            maritalStatus:
              personalForm.maritalStatus,

            maritalVisibility:
              personalPrivacy
                .showMaritalStatus
                ? "Public"
                : "Private",

            country:
              personalForm.country
                .trim()
                .slice(0, 80),

            city:
              personalForm.city
                .trim()
                .slice(0, 80),

            languages,

            profileFact:
              personalForm.profileFact
                .trim()
                .slice(0, 160),

            privacy: {
              ...personalPrivacy,
            },
          },
          getKristoHeaders({
            userId,
            role:
              (session?.role ||
                session?.churchRole ||
                "Member") as any,
            churchId: String(
              session?.churchId || ""
            ).trim(),
          })
        );

      if (!response?.ok) {
        Alert.alert(
          "Save failed",
          String(
            response?.error ||
              "Could not save your information."
          )
        );
        return;
      }

      setPersonalInfoLoaded(true);

      console.log(
        "KRISTO_PERSONAL_SETTINGS_SAVED",
        {
          userId,
          showGender:
            personalPrivacy.showGender,
          showCountry:
            personalPrivacy.showCountry,
          showAge: dobPublic,
          showMaritalStatus:
            personalPrivacy
              .showMaritalStatus,
          showChurchHistory:
            personalPrivacy
              .showChurchHistory,
        }
      );

      Alert.alert(
        "Saved",
        "Your personal information and public privacy settings were updated."
      );
    } catch (error: any) {
      Alert.alert(
        "Save failed",
        String(
          error?.message ||
            "Could not save your information."
        )
      );
    } finally {
      setSavingPersonalInfo(false);
    }
  }

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
        const reason = String(data?.error || data?.reason || "").trim();
        if (reason === "pastor-owns-church") {
          setPastorOwnershipCheck({
            blocked: true,
            churches: Array.isArray(data?.pastorOwnsChurches) ? data.pastorOwnsChurches : [],
          });
          setPastorOwnsChurchModalOpen(true);
          return;
        }
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
    setLockHolderModalOpen(false);
    setInlineStatusMessage(null);
    setProcessingOption(null);
    setManagingLockHolderSubscription(false);
    setFinalConfirmVariant(variant);
    setFinalConfirmOpen(true);
  }, []);

  const resolveDeleteGate = useCallback((check: AccountDeleteSubscriptionCheck) => {
    const { userId, role, churchId } = deleteContextRef.current;
    return resolveAccountDeleteSubscriptionOwnerGate({
      check,
      userId,
      churchId,
      role,
    });
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

  const handleResumeAfterSubscriptionManagement = useCallback(async () => {
    const { userId, churchId, role } = deleteContextRef.current;
    if (!userId) return;

    if (pendingLockHolderManageRef.current) {
      pendingLockHolderManageRef.current = false;
      setManagingLockHolderSubscription(false);
      setLockHolderModalOpen(true);
      return;
    }

    if (!pendingCancelSubAfterManagementRef.current) return;

    pendingCancelSubAfterManagementRef.current = false;
    setCheckingSubscription(true);
    try {
      const check = await runSubscriptionCheck();
      setSubscriptionCheck(check);
      setProcessingOption(null);

      const gate = resolveDeleteGate(check);

      if (!gate.canManageSubscription) {
        if (gate.modalType === "lock_holder_non_pastor") {
          setLockHolderModalOpen(true);
          return;
        }
        openFinalConfirm(gate.modalType === "member_confirm" ? "member" : "standard");
        return;
      }

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
      setProcessingOption(null);
      openFinalConfirm("standard");
    } finally {
      setCheckingSubscription(false);
    }
  }, [openFinalConfirm, resolveDeleteGate, runSubscriptionCheck]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      if (
        !pendingCancelSubAfterManagementRef.current &&
        !pendingLockHolderManageRef.current
      ) {
        return;
      }
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

    const gate = resolveDeleteGate(check);

    if (!gate.canManageSubscription) {
      if (gate.modalType === "lock_holder_non_pastor") {
        setChoiceModalOpen(false);
        setLockHolderModalOpen(true);
        return;
      }
      openFinalConfirm(gate.modalType === "member_confirm" ? "member" : "standard");
      return;
    }

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
  }, [openFinalConfirm, resolveDeleteGate, subscriptionCheck]);

  const handleLockHolderManageSubscription = useCallback(async () => {
    const check = subscriptionCheck;
    if (!check || flowBusy) return;

    setManagingLockHolderSubscription(true);
    setInlineStatusMessage(null);
    pendingLockHolderManageRef.current = true;

    const result = await openAccountDeleteSubscriptionManagement(check);
    if (!result.opened) {
      pendingLockHolderManageRef.current = false;
      setManagingLockHolderSubscription(false);
      setInlineStatusMessage(getAccountDeleteStoreManagementFallbackMessage());
    }
  }, [flowBusy, subscriptionCheck]);

  const handleLockHolderDeleteAccount = useCallback(() => {
    if (flowBusy) return;
    openFinalConfirm("lock_holder");
  }, [flowBusy, openFinalConfirm]);

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
    setLockHolderModalOpen(false);
    setPastorOwnsChurchModalOpen(false);
    setFinalConfirmOpen(false);
    setInlineStatusMessage(null);
    setProcessingOption(null);
    setManagingLockHolderSubscription(false);
    pendingCancelSubAfterManagementRef.current = false;
    pendingLockHolderManageRef.current = false;
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
      const pastorCheck = await checkAccountDeletePastorOwnership({
        headers: getKristoHeaders({
          userId,
          role: role as any,
          churchId,
        }) as Record<string, string>,
      });

      if (pastorCheck.blocked) {
        setPastorOwnershipCheck(pastorCheck);
        setDeleteModalOpen(false);
        setPastorOwnsChurchModalOpen(true);
        return;
      }

      const check = await runSubscriptionCheck();
      const gate = resolveDeleteGate(check);

      setDeleteModalOpen(false);

      if (gate.modalType === "owner_choice") {
        setSubscriptionCheck(check);
        setChoiceModalOpen(true);
        return;
      }

      setSubscriptionCheck(check);

      if (gate.modalType === "lock_holder_non_pastor") {
        setLockHolderModalOpen(true);
        return;
      }

      if (gate.modalType === "member_confirm") {
        openFinalConfirm("member");
        return;
      }

      openFinalConfirm("standard");
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

        <Text style={s.sectionLabel}>
          Personal Information
        </Text>

        <View style={s.personalCard}>
          {loadingPersonalInfo &&
          !personalInfoLoaded ? (
            <View style={s.personalLoading}>
              <ActivityIndicator
                size="small"
                color={GOLD}
              />

              <Text style={s.personalLoadingText}>
                Loading your information…
              </Text>
            </View>
          ) : (
            <>
              <Text style={s.fieldLabel}>
                Gender
              </Text>

              <View style={s.optionRow}>
                {GENDER_OPTIONS.map(
                  (option) => {
                    const active =
                      personalForm.gender ===
                      option.value;

                    return (
                      <Pressable
                        key={option.value}
                        onPress={() =>
                          updatePersonalField(
                            "gender",
                            option.value
                          )
                        }
                        style={({ pressed }) => [
                          s.optionChip,
                          active &&
                            s.optionChipActive,
                          pressed && s.pressed,
                        ]}
                      >
                        <Ionicons
                          name={option.icon}
                          size={17}
                          color={
                            active
                              ? GOLD
                              : MUTED
                          }
                        />

                        <Text
                          style={[
                            s.optionChipText,
                            active &&
                              s.optionChipTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  }
                )}
              </View>

              <Text style={s.fieldLabel}>
                Date of birth
              </Text>

              <TextInput
                value={personalForm.dob}
                onChangeText={(value) =>
                  updatePersonalField(
                    "dob",
                    value
                      .replace(
                        /[^0-9-]/g,
                        ""
                      )
                      .slice(0, 10)
                  )
                }
                placeholder="YYYY-MM-DD"
                placeholderTextColor="rgba(255,255,255,0.32)"
                keyboardType="numbers-and-punctuation"
                style={s.personalInput}
              />

              <Text style={s.fieldHint}>
                Your birthday is saved privately. Public viewers see your age only when you allow it below.
              </Text>

              <Text style={s.fieldLabel}>
                Marital status
              </Text>

              <View style={s.wrapOptions}>
                {MARITAL_OPTIONS.map(
                  (option) => {
                    const active =
                      personalForm
                        .maritalStatus ===
                      option.value;

                    return (
                      <Pressable
                        key={option.value}
                        onPress={() =>
                          updatePersonalField(
                            "maritalStatus",
                            option.value
                          )
                        }
                        style={({ pressed }) => [
                          s.smallOptionChip,
                          active &&
                            s.optionChipActive,
                          pressed && s.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            s.optionChipText,
                            active &&
                              s.optionChipTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  }
                )}
              </View>

              <View style={s.twoColumnRow}>
                <View style={s.twoColumnField}>
                  <Text style={s.fieldLabel}>
                    Country
                  </Text>

                  <TextInput
                    value={
                      personalForm.country
                    }
                    onChangeText={(value) =>
                      updatePersonalField(
                        "country",
                        value.slice(0, 80)
                      )
                    }
                    placeholder="Country"
                    placeholderTextColor="rgba(255,255,255,0.32)"
                    autoCapitalize="words"
                    style={s.personalInput}
                  />
                </View>

                <View style={s.twoColumnField}>
                  <Text style={s.fieldLabel}>
                    City
                  </Text>

                  <TextInput
                    value={personalForm.city}
                    onChangeText={(value) =>
                      updatePersonalField(
                        "city",
                        value.slice(0, 80)
                      )
                    }
                    placeholder="City"
                    placeholderTextColor="rgba(255,255,255,0.32)"
                    autoCapitalize="words"
                    style={s.personalInput}
                  />
                </View>
              </View>

              <Text style={s.fieldLabel}>
                Languages
              </Text>

              <TextInput
                value={
                  personalForm.languages
                }
                onChangeText={(value) =>
                  updatePersonalField(
                    "languages",
                    value.slice(0, 160)
                  )
                }
                placeholder="Swahili, English, Kirundi"
                placeholderTextColor="rgba(255,255,255,0.32)"
                autoCapitalize="words"
                style={s.personalInput}
              />

              <Text style={s.fieldHint}>
                Separate languages with commas. Maximum 8 languages.
              </Text>

              <Text style={s.fieldLabel}>
                Profile Fact
              </Text>

              <TextInput
                value={
                  personalForm.profileFact
                }
                onChangeText={(value) =>
                  updatePersonalField(
                    "profileFact",
                    value.slice(0, 160)
                  )
                }
                placeholder="Share one meaningful fact about yourself."
                placeholderTextColor="rgba(255,255,255,0.32)"
                multiline
                maxLength={160}
                textAlignVertical="top"
                style={[
                  s.personalInput,
                  s.profileFactInput,
                ]}
              />

              <Text style={s.characterCount}>
                {
                  personalForm
                    .profileFact.length
                }/160
              </Text>
            </>
          )}
        </View>

        <Text style={s.sectionLabel}>
          Privacy & Public Profile
        </Text>

        <View style={s.privacyCard}>
          <View style={s.privacyIntro}>
            <View style={s.privacyIntroIcon}>
              <Ionicons
                name="shield-checkmark-outline"
                size={22}
                color={GOLD}
              />
            </View>

            <View style={s.privacyIntroText}>
              <Text style={s.privacyIntroTitle}>
                Control More About
              </Text>

              <Text style={s.privacyIntroSub}>
                Only information you enable here will appear to other members.
              </Text>
            </View>
          </View>

          <PrivacySettingRow
            icon="male-female-outline"
            title="Show gender"
            subtitle="Allow members to see your gender."
            value={
              personalPrivacy.showGender
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showGender",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="hourglass-outline"
            title="Show age"
            subtitle="Your birthday stays private; only your calculated age is shown."
            value={dobPublic}
            onChange={setDobPublic}
          />

          <PrivacySettingRow
            icon="earth-outline"
            title="Show country"
            subtitle="Display your country in More About."
            value={
              personalPrivacy.showCountry
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showCountry",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="location-outline"
            title="Show city"
            subtitle="Display your city in More About."
            value={
              personalPrivacy.showCity
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showCity",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="heart-outline"
            title="Show marital status"
            subtitle="Allow members to see your marital status."
            value={
              personalPrivacy
                .showMaritalStatus
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showMaritalStatus",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="language-outline"
            title="Show languages"
            subtitle="Display the languages you speak."
            value={
              personalPrivacy
                .showLanguages
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showLanguages",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="sparkles-outline"
            title="Show Profile Fact"
            subtitle="Display your public Profile Fact."
            value={
              personalPrivacy
                .showProfileFact
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showProfileFact",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="calendar-outline"
            title="Show Kristo member since"
            subtitle="Display when you joined Kristo App."
            value={
              personalPrivacy
                .showMemberSince
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showMemberSince",
                value
              )
            }
          />

          <PrivacySettingRow
            icon="trail-sign-outline"
            title="Show church journey"
            subtitle="Allow verified church history when the system record becomes available."
            value={
              personalPrivacy
                .showChurchHistory
            }
            onChange={(value) =>
              updatePersonalPrivacy(
                "showChurchHistory",
                value
              )
            }
          />
        </View>

        <Pressable
          onPress={() =>
            void savePersonalInformation()
          }
          disabled={
            loadingPersonalInfo ||
            savingPersonalInfo
          }
          style={({ pressed }) => [
            s.savePersonalButton,
            pressed &&
              !savingPersonalInfo &&
              s.pressed,
            (
              loadingPersonalInfo ||
              savingPersonalInfo
            ) &&
              s.savePersonalButtonDisabled,
          ]}
        >
          {savingPersonalInfo ? (
            <ActivityIndicator
              size="small"
              color="#07111F"
            />
          ) : (
            <Ionicons
              name="checkmark-circle-outline"
              size={21}
              color="#07111F"
            />
          )}

          <Text style={s.savePersonalText}>
            {savingPersonalInfo
              ? "Saving…"
              : "Save Personal Information"}
          </Text>
        </Pressable>

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

      <DeleteAccountPastorOwnsChurchModal
        visible={pastorOwnsChurchModalOpen}
        churches={pastorOwnershipCheck?.churches || []}
        sessionChurchId={session?.churchId}
        sessionChurchName={session?.churchName}
        sessionChurchAvatarUrl={
          String((session as any)?.churchAvatarUri || (session as any)?.churchAvatarUrl || "").trim() ||
          null
        }
        disabled={checkingSubscription || deleting}
        onGoToChurch={() => {
          closeDeleteFlow();
          router.push("/more/church" as any);
        }}
        onNotNow={closeDeleteFlow}
      />

      <DeleteAccountLockHolderModal
        visible={lockHolderModalOpen}
        disabled={checkingSubscription || deleting}
        managing={managingLockHolderSubscription}
        inlineStatusMessage={inlineStatusMessage}
        onManageSubscription={() => {
          void handleLockHolderManageSubscription();
        }}
        onDeleteAccount={handleLockHolderDeleteAccount}
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

const s = StyleSheet.create<any>({
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

  personalCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 22,
    backgroundColor:
      "rgba(255,255,255,0.035)",
    padding: 15,
    marginBottom: 22,
  },

  personalLoading: {
    minHeight: 110,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  personalLoadingText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },

  fieldLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.45,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 7,
  },

  fieldHint: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 6,
  },

  personalInput: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.18)",
    backgroundColor:
      "rgba(0,0,0,0.20)",
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 13,
  },

  profileFactInput: {
    minHeight: 94,
    paddingTop: 13,
    paddingBottom: 13,
  },

  characterCount: {
    color: "rgba(255,255,255,0.40)",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "right",
    marginTop: 5,
  },

  optionRow: {
    flexDirection: "row",
    gap: 9,
  },

  wrapOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  optionChip: {
    flex: 1,
    minHeight: 45,
    borderRadius: 14,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
    backgroundColor:
      "rgba(255,255,255,0.035)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 11,
  },

  smallOptionChip: {
    minHeight: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
    backgroundColor:
      "rgba(255,255,255,0.035)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
  },

  optionChipActive: {
    borderColor:
      "rgba(244,208,111,0.62)",
    backgroundColor:
      "rgba(244,208,111,0.11)",
  },

  optionChipText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
  },

  optionChipTextActive: {
    color: GOLD,
  },

  twoColumnRow: {
    flexDirection: "row",
    gap: 10,
  },

  twoColumnField: {
    flex: 1,
    minWidth: 0,
  },

  privacyCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 22,
    backgroundColor:
      "rgba(255,255,255,0.035)",
    overflow: "hidden",
  },

  privacyIntro: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    backgroundColor:
      "rgba(244,208,111,0.055)",
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(255,255,255,0.07)",
  },

  privacyIntroIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.11)",
  },

  privacyIntroText: {
    flex: 1,
    marginLeft: 11,
  },

  privacyIntroTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  privacyIntroSub: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 3,
  },

  privacyRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth:
      StyleSheet.hairlineWidth,
    borderBottomColor:
      "rgba(255,255,255,0.08)",
  },

  privacyRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.045)",
  },

  privacyRowIconActive: {
    backgroundColor:
      "rgba(244,208,111,0.10)",
  },

  privacyRowCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 11,
    marginRight: 10,
  },

  privacyRowTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },

  privacyRowSub: {
    color: "rgba(255,255,255,0.47)",
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 3,
  },

  toggleTrack: {
    width: 45,
    height: 27,
    borderRadius: 14,
    padding: 3,
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.12)",
  },

  toggleTrackActive: {
    backgroundColor:
      "rgba(244,208,111,0.78)",
  },

  toggleKnob: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
  },

  toggleKnobActive: {
    alignSelf: "flex-end",
    backgroundColor: "#07111F",
  },

  savePersonalButton: {
    minHeight: 54,
    marginTop: 14,
    marginBottom: 25,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: GOLD,
  },

  savePersonalButtonDisabled: {
    opacity: 0.55,
  },

  savePersonalText: {
    color: "#07111F",
    fontSize: 14,
    fontWeight: "900",
  },

});
