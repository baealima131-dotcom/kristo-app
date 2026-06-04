import React, { useMemo, useState } from "react";
import { useRouter, Href } from "expo-router";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { saveProfileDraft } from "@/src/lib/profileStore";
import { apiGet, apiPost, getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  DEFAULT_KRISTO_COUNTRY,
  filterKristoCountries,
  type KristoCountry,
} from "@/src/lib/countries";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.65)";
const BORDER = "rgba(255,255,255,0.10)";

const MIN_AGE = 14;
const MAX_AGE = 100;
const AGE_OPTIONS = Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => i + MIN_AGE);

function dobFromAge(ageValue: number | string | null | undefined) {
  const n = Number(ageValue);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const year = new Date().getFullYear() - Math.floor(n);
  return `${year}-01-01`;
}

function formatVerifyError(data: any) {
  const reason = String(data?.reason || "").trim();
  const serverError = String(data?.error || "").trim();
  if (reason === "expired" || reason === "superseded") {
    return serverError || "Code expired or replaced.";
  }
  if (reason === "invalid_code") return "The code is incorrect.";
  if (serverError) return serverError;
  return "Verification failed.";
}

function formatProfileError(data: any, fallback: string) {
  const serverError = String(data?.error || "").trim();
  const reason = String(data?.reason || "").trim();
  const status = typeof data?.status === "number" ? ` (HTTP ${data.status})` : "";
  if (serverError && reason) return `${serverError}${status}`;
  if (serverError) return `${serverError}${status}`;
  return `${fallback}${status}`;
}

const PASSWORD_RULES_HINT =
  "Use 8+ characters with at least one letter and one number.";

const VERIFICATION_EMAIL_FAILED_MSG =
  "We could not send a verification code to this email. Please use a valid email address or sign in with the review account.";

const VERIFY_STEP_MESSAGE = "Enter the verification code sent to your email.";

function isSignupEmailSendFailure(data: any) {
  const reason = String(data?.reason || "").trim();
  return (
    reason === "email_send_failed" ||
    reason === "email_not_configured" ||
    /email/i.test(String(data?.error || ""))
  );
}

function isSignupPasswordValid(value: string) {
  const pwd = String(value || "");
  if (pwd.length < 8) return false;
  if (!/[A-Za-z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  return true;
}

type SignupGender = "MALE" | "FEMALE";

function signupGenderLabel(value: SignupGender | null) {
  if (value === "MALE") return "Male";
  if (value === "FEMALE") return "Female";
  return "Skip";
}

function buildSignupPhone(dialCode: string, local: string): string | undefined {
  const localTrim = local.trim();
  if (!localTrim) return undefined;
  const prefix = String(dialCode || "").trim();
  if (!prefix) return localTrim;
  return `${prefix} ${localTrim}`.trim();
}

function validateOptionalPhoneLocal(local: string): string | null {
  const trimmed = local.trim();
  if (!trimmed) return null;
  if (trimmed.length < 6) return "Enter a valid phone number or leave it blank.";
  return null;
}

function getSignupPasswordValidationMessage(password: string, confirmPassword: string) {
  const pwd = String(password || "");
  const hasConfirmPassword = confirmPassword.trim().length > 0;
  const passwordsMismatch = hasConfirmPassword && pwd !== confirmPassword;
  if (!pwd.trim()) return "Enter a password.";
  if (pwd.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(pwd)) return "Password must include at least one letter.";
  if (!/[0-9]/.test(pwd)) return "Password must include at least one number.";
  if (passwordsMismatch) return "Passwords do not match.";
  return null;
}

export default function SignupScreen() {
  const router = useRouter();
  const { setSession } = useKristoSession();

  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState<number | null>(null);
  const [ageOpen, setAgeOpen] = useState(false);
  const [country, setCountry] = useState<KristoCountry>(DEFAULT_KRISTO_COUNTRY);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [gender, setGender] = useState<SignupGender | null>(null);
  const [genderOpen, setGenderOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [step, setStep] = useState<"form" | "verify">("form");
  const [emailInput, setEmailInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [verifyInfo, setVerifyInfo] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState("");
  const [publicKristoId, setPublicKristoId] = useState("");
  const [signupChallengeId, setSignupChallengeId] = useState("");

  const signupPhone = useMemo(
    () => buildSignupPhone(country.dialCode, phoneLocal),
    [country.dialCode, phoneLocal]
  );

  const filteredCountries = useMemo(
    () => filterKristoCountries(countrySearch),
    [countrySearch]
  );

  function closeCountryPicker() {
    setCountryOpen(false);
    setCountrySearch("");
  }

  const passwordSaved = useMemo(
    () => isSignupPasswordValid(password) && password === confirmPassword,
    [password, confirmPassword]
  );

  const hasConfirmPassword = confirmPassword.trim().length > 0;
  const passwordsMismatch = hasConfirmPassword && password !== confirmPassword;

  const passwordValidationMessage = useMemo(() => {
    if (passwordsMismatch) return "Passwords do not match.";
    return getSignupPasswordValidationMessage(password, confirmPassword);
  }, [password, confirmPassword, passwordsMismatch]);

  const countryReady = Boolean(country?.name?.trim());

  const canForm = useMemo(() => {
    return (
      fullName.trim().length >= 2 &&
      email.trim().includes("@") &&
      passwordSaved &&
      !!age &&
      age >= MIN_AGE &&
      countryReady &&
      !saving
    );
  }, [fullName, email, passwordSaved, age, countryReady, saving]);

  function onPressSendCode() {
    const pwdMsg = getSignupPasswordValidationMessage(password, confirmPassword);
    if (pwdMsg) {
      setErr(pwdMsg);
      setPasswordOpen(true);
      return;
    }
    if (!canForm || saving) return;
    void sendVerification();
  }

  const canVerify =
    emailInput.trim().length >= 4 &&
    !!signupChallengeId &&
    !saving;

  function logDevVerificationCodeConsoleOnly(data: any) {
    if (!__DEV__) return;
    const leakedCode = String(data?.devOtp || data?.reviewVerificationCode || data?.code || "").trim();
    if (!leakedCode) return;
    console.log("[KRISTO_SIGNUP_DEV_OTP]", {
      challengeId: data?.challengeId || null,
      note: "dev console only — never shown in UI",
      code: leakedCode,
    });
  }

  function applyVerificationStepAfterSend(data: any) {
    setCreatedUserId(String(data.userId || "").trim());
    setPublicKristoId(String(data.kristoId || data.publicKristoId || "").trim());
    setSignupChallengeId(data.challengeId || "");
    setEmailInput("");

    logDevVerificationCodeConsoleOnly(data);
    setVerifyInfo(VERIFY_STEP_MESSAGE);
    setStep("verify");
  }

  async function finalizeSignupAccount(finalUserId: string) {
    const profileRes: any = await apiGet("/api/auth/profile", {
      headers: getKristoHeaders({ userId: finalUserId, role: "Member", churchId: "" }),
    });

    if (!profileRes?.ok) {
      const message = String(profileRes?.error || "Account verified but server profile is unavailable.");
      setErr(`${message} Try signing in with your email and password.`);
      if (__DEV__) {
        console.warn("[KRISTO SIGNUP] durable profile load failed after verify", profileRes);
      }
      return false;
    }

    const p = profileRes?.profile;
    const kristoId = String(publicKristoId || p?.userCode || "").trim();
    const finalName = String(p?.fullName || fullName.trim());

    const phoneValue = signupPhone;
    const addressValue = address.trim();
    const cityValue = city.trim();
    const genderValue = gender === "MALE" || gender === "FEMALE" ? gender : undefined;

    const profilePayload: Record<string, unknown> = {
      userCode: kristoId,
      fullName: finalName,
      email: email.trim(),
      country: country.name,
      dob: age ? dobFromAge(age) : undefined,
    };
    if (phoneValue) profilePayload.phone = phoneValue;
    if (genderValue) profilePayload.gender = genderValue;
    if (cityValue) profilePayload.city = cityValue;

    const profileData = await apiPost(
      "/api/auth/profile",
      profilePayload,
      getKristoHeaders({ userId: finalUserId, role: "Member", churchId: "" })
    );

    if (!profileData?.ok) {
      const message = formatProfileError(profileData, "Could not save your profile. Please try again.");
      if (__DEV__) {
        console.warn("[KRISTO SIGNUP] profile save failed", profileData);
      }
      Alert.alert("Profile save failed", message);
      setErr(message);
      return false;
    }

    await setSession({
      userId: finalUserId,
      kristoId,
      role: "Member",
      churchId: "",
      name: finalName,
      displayName: finalName,
      email: email.trim(),
      country: country.name,
      age: age ?? undefined,
      ...(phoneValue ? { phone: phoneValue } : {}),
      ...(addressValue ? { address: addressValue } : {}),
      ...(cityValue ? { city: cityValue } : {}),
      ...(genderValue ? { gender: genderValue } : {}),
    } as any);

    await saveProfileDraft(
      {
        userId: finalUserId,
        kristoId,
        displayName: finalName,
        bio: "",
        avatarUri: undefined,
        email: email.trim(),
        country: country.name,
        age: age ?? undefined,
        ...(phoneValue ? { phone: phoneValue } : {}),
        ...(addressValue ? { address: addressValue } : {}),
        ...(cityValue ? { city: cityValue } : {}),
        ...(genderValue ? { gender: genderValue } : {}),
      },
      finalUserId
    );

    router.replace("/(tabs)");
    return true;
  }

  async function resendVerificationCode() {
    if (!signupChallengeId) {
      setErr("Send the code first, or go back to the form and try again.");
      return;
    }

    setErr(null);
    setSaving(true);

    try {
      const data = await apiPost("/api/auth/sign-up/resend", {
        challengeId: signupChallengeId,
      });

      if (!data?.ok) {
        console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
          scope: "mobile-resend",
          reason: data?.reason || null,
          error: data?.error || null,
        });
        setErr(
          isSignupEmailSendFailure(data)
            ? VERIFICATION_EMAIL_FAILED_MSG
            : String(data?.error || VERIFICATION_EMAIL_FAILED_MSG)
        );
        return;
      }

      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_SENT", {
        scope: "mobile-resend",
        challengeId: signupChallengeId,
      });

      logDevVerificationCodeConsoleOnly(data);
      setEmailInput("");
      setVerifyInfo(VERIFY_STEP_MESSAGE);
    } catch (error: any) {
      const message = String(error?.message || error || "Network request failed");
      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
        scope: "mobile-resend",
        error: message,
      });
      setErr(`${VERIFICATION_EMAIL_FAILED_MSG} (${message})`);
    } finally {
      setSaving(false);
    }
  }

  async function sendVerification() {
    if (!age || age < MIN_AGE) {
      setErr("Kristo requires age 14+");
      return;
    }
    if (!countryReady) {
      setErr("Select your country.");
      setCountryOpen(true);
      return;
    }
    const pwdMsg = getSignupPasswordValidationMessage(password, confirmPassword);
    if (pwdMsg) {
      setErr(pwdMsg);
      setPasswordOpen(true);
      return;
    }
    const phoneErr = validateOptionalPhoneLocal(phoneLocal);
    if (phoneErr) {
      setErr(phoneErr);
      setPhoneOpen(true);
      return;
    }
    if (!canForm) return;
    setErr(null);
    setVerifyInfo(null);
    setSaving(true);

    try {
      const phoneValue = signupPhone;
      const cityValue = city.trim();
      const genderValue = gender === "MALE" || gender === "FEMALE" ? gender : undefined;

      const signUpPayload: Record<string, unknown> = {
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        age,
        dob: dobFromAge(age),
        country: country.name,
      };
      if (phoneValue) signUpPayload.phone = phoneValue;
      if (genderValue) signUpPayload.gender = genderValue;
      if (cityValue) signUpPayload.city = cityValue;

      const data = await apiPost("/api/auth/sign-up", signUpPayload);

      if (!data?.ok) {
        const serverError = String(data?.error || "").trim();
        const reason = String(data?.reason || "").trim();
        console.log("KRISTO_SIGNUP_VERIFY_EMAIL_FAILED", {
          reason: reason || null,
          error: serverError || null,
        });
        if (reason === "account_exists" || /already registered|tayari imesajiliwa/i.test(serverError)) {
          setErr("This email is already registered. Sign in with your password to continue.");
          return;
        }
        const status = typeof data?.status === "number" ? ` (HTTP ${data.status})` : "";
        const detail = [serverError, reason && reason !== "http_error" ? `Reason: ${reason}` : ""]
          .filter(Boolean)
          .join(" ");
        setErr(
          isSignupEmailSendFailure(data)
            ? VERIFICATION_EMAIL_FAILED_MSG
            : detail || `Could not send verification code${status}. API: ${getApiBase()}`
        );
        if (__DEV__) {
          console.warn("[KRISTO SIGNUP] sign-up failed", { data, apiBase: getApiBase() });
        }
        return;
      }

      console.log("KRISTO_SIGNUP_VERIFY_EMAIL_SENT", {
        email: email.trim(),
        userId: data.userId || null,
      });

      applyVerificationStepAfterSend(data);
    } catch (error: any) {
      const message = String(error?.message || error || "Network request failed");
      setErr(`Could not connect to ${getApiBase()}. ${message}`);
      if (__DEV__) {
        console.warn("[KRISTO SIGNUP] network error", error);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onCreate() {
    if (!canVerify) return;
    setErr(null);
    setSaving(true);

    try {
      const data = await apiPost("/api/auth/login/verify", {
        challengeId: signupChallengeId,
        code: emailInput.trim(),
      });

      if (!data?.ok) {
        setErr(formatVerifyError(data));
        if (__DEV__) {
          console.warn("[KRISTO SIGNUP] verify failed", data);
        }
        return;
      }

      if (__DEV__) {
        console.log("[KRISTO SIGNUP] verify ok", {
          userId: data?.user?.id || createdUserId,
          sessionId: data?.session?.id,
        });
      }

      const finalUserId = String(data?.user?.id || createdUserId || "").trim();
      if (!finalUserId) {
        setErr("Verification failed. Missing user id.");
        return;
      }

      if (!data?.user?.id && !createdUserId) {
        setErr("Verification succeeded but durable account id is missing.");
        return;
      }

      await finalizeSignupAccount(finalUserId);
    } catch (error: any) {
      const message = String(error?.message || error || "Verification failed.");
      setErr(`Verification failed. ${message}`);
      if (__DEV__) {
        console.warn("[KRISTO SIGNUP] verify/profile error", error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.titleWrap}>
        <View style={s.titleGlow}/>
        <Text style={s.title}>WELCOME TO KRISTO</Text>
      </View>

      <View style={s.card}>
        {!!err && <Text style={s.err}>{err}</Text>}
        {step === "form" ? (
          <>
            <Text style={s.label}>Full name</Text>
            <View style={s.nameRow}>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your full name"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={[s.input, s.nameInput]}
              />
            </View>

            <Text style={s.labelGap}>Account</Text>
            <View style={s.emailPasswordRow}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={[s.input, s.emailHalfInput]}
              />

              <Pressable
                onPress={() => setPasswordOpen((v) => !v)}
                style={[s.passwordHalfCard, passwordSaved && s.passwordHalfDone]}
              >
                <Text style={s.passwordHalfLabel} numberOfLines={1}>
                  Password
                </Text>
                <Text style={s.passwordHalfValue} numberOfLines={1} ellipsizeMode="tail">
                  {passwordSaved ? "Saved" : "Tap to set"}
                </Text>
              </Pressable>
            </View>

            <Text style={s.passwordHint}>{PASSWORD_RULES_HINT}</Text>
            {!passwordSaved &&
            (password.length > 0 || hasConfirmPassword) &&
            (passwordsMismatch || passwordValidationMessage) ? (
              <Text style={s.passwordHintWarn}>
                {passwordsMismatch ? "Passwords do not match." : passwordValidationMessage}
              </Text>
            ) : null}

            {passwordOpen ? (
              <View style={s.passwordPanelBlue}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create password"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  multiline={false}
                  numberOfLines={1}
                  style={s.passwordInputVip}
                />
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  multiline={false}
                  numberOfLines={1}
                  style={[s.passwordInputVip, s.passwordInputVipGap]}
                />

                <View style={s.passwordActions}>
                  <Pressable
                    onPress={() => {
                      setShowPassword((v) => !v);
                      setShowConfirm((v) => !v);
                    }}
                    style={s.passwordMiniBtn}
                  >
                    <Text style={s.passwordMiniText}>{showPassword ? "Hide" : "Show"}</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (passwordSaved) setPasswordOpen(false);
                    }}
                    disabled={!passwordSaved}
                    style={[s.passwordSaveBtnBlue, !passwordSaved && { opacity: 0.45 }]}
                  >
                    <Text style={s.passwordSaveText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Text style={s.labelGap}>Country</Text>
            <Pressable
              onPress={() => setCountryOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Country, ${country.name}. Tap to change.`}
              style={s.countrySelectCard}
            >
              <Text style={s.flag}>{country.flag}</Text>
              <Text style={s.selectText}>{country.name}</Text>
              <Text style={s.countryChangeHint}>Change</Text>
            </Pressable>

            <Text style={s.labelGap}>Address (Optional)</Text>
            <TextInput value={address} onChangeText={setAddress} placeholder="Street address" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />

            <Text style={s.labelGap}>City (Optional)</Text>
            <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />

            <Text style={s.labelGap}>Phone number (Optional)</Text>
            <View style={s.phoneRow}>
              <View style={s.codeBox}>
                <Text style={s.codeText}>{country.dialCode || "—"}</Text>
              </View>
              <Pressable onPress={() => setPhoneOpen(true)} style={[s.input, s.phoneInput, s.phoneSelect]}>
                <Text style={[s.phoneSelectText, !phoneLocal.trim() && s.phoneSelectPlaceholder]}>
                  {phoneLocal.trim() || "Tap to add phone (optional)"}
                </Text>
              </Pressable>
            </View>

            <View style={s.splitBtn}>
              <Pressable onPress={() => setGenderOpen(true)} style={s.splitGender}>
                <Text style={s.splitGenderSmall}>Gender</Text>
                <Text style={s.splitGenderText} numberOfLines={1}>
                  {signupGenderLabel(gender)}
                </Text>
              </Pressable>

              <Pressable onPress={() => setAgeOpen(true)} style={s.splitAge}>
                <Text style={s.splitSmall}>Age</Text>
                <Text style={s.splitAgeText}>{age ? `${age}` : "Select"}</Text>
              </Pressable>

              <Pressable
                onPress={onPressSendCode}
                disabled={!canForm || saving}
                style={[s.splitSend, canForm ? s.splitSendActive : s.splitSendDisabled]}
              >
                <Text style={[s.splitSendText, !canForm && s.splitSendTextDisabled]}>
                  {saving ? "Sending..." : "Send code"}
                </Text>
              </Pressable>
            </View>

            {!age ? (
              <Text style={s.ageHint}>Kristo requires age 14+</Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={s.notice}>
              <Text style={s.noticeTitle}>SHALOM</Text>
              <Text style={s.noticeBig}>Let’s verify your account.</Text>
              <Text style={s.noticeText}>{verifyInfo || VERIFY_STEP_MESSAGE}</Text>
            </View>

            <Text style={s.label}>Verification code</Text>
            <TextInput
              value={emailInput}
              onChangeText={setEmailInput}
              keyboardType="number-pad"
              textContentType="none"
              autoComplete="off"
              autoCorrect={false}
              importantForAutofill="no"
              placeholder="Enter the code from your email"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={s.input}
            />

            <Pressable onPress={onCreate} disabled={!canVerify || saving} style={[s.btn, (!canVerify || saving) && { opacity: 0.45 }]}>
              <Text style={s.btnText}>{saving ? "Verifying..." : "Confirm & Create account"}</Text>
            </Pressable>

            <Pressable
              onPress={resendVerificationCode}
              disabled={saving || !signupChallengeId}
              style={[s.linkBtn, (saving || !signupChallengeId) && { opacity: 0.45 }]}
            >
              <Text style={s.linkText}>{saving ? "Sending..." : "Resend code"}</Text>
            </Pressable>

            <Pressable onPress={() => setStep("form")} style={s.linkBtn}>
              <Text style={s.linkText}>Back to form</Text>
            </Pressable>
          </>
        )}

        <Pressable onPress={() => router.replace("/(auth)/login" as Href)} style={s.linkBtn}>
          <Text style={s.linkText}>Back to Login</Text>
        </Pressable>
      </View>
      <Modal visible={countryOpen} transparent animationType="fade" onRequestClose={closeCountryPicker}>
        <View style={s.modalWrap}>
          <Pressable style={s.modalBackdrop} onPress={closeCountryPicker} />

          <View style={s.countrySheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select country</Text>

            <TextInput
              value={countrySearch}
              onChangeText={setCountrySearch}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Search name, ISO, or dial code"
              placeholderTextColor="rgba(255,255,255,0.38)"
              style={s.countrySearchInput}
            />

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {filteredCountries.length === 0 ? (
                <Text style={s.countrySearchEmpty}>No countries match your search.</Text>
              ) : (
                filteredCountries.map((c) => {
                  const active = c.code === country.code;
                  return (
                    <Pressable
                      key={c.code}
                      onPress={() => {
                        setCountry(c);
                        closeCountryPicker();
                      }}
                      style={[s.sheetOption, active && s.sheetOptionOn]}
                    >
                      <Text style={s.flagSmall}>{c.flag}</Text>
                      <View style={s.countryOptionTextWrap}>
                        <Text style={[s.countryName, active && s.countryNameOn]}>{c.name}</Text>
                        <Text style={s.countryOptionMeta}>
                          {c.code}
                          {c.dialCode ? ` · ${c.dialCode}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={genderOpen} transparent animationType="fade" onRequestClose={() => setGenderOpen(false)}>
        <View style={s.genderModalWrap}>
          <Pressable style={s.genderBackdrop} onPress={() => setGenderOpen(false)} />
          <View style={s.genderSheet}>
            <Text style={s.genderSheetTitle}>Gender</Text>
            <Text style={s.genderSheetSub}>Optional</Text>
            {(
              [
                { value: "MALE" as const, label: "Male" },
                { value: "FEMALE" as const, label: "Female" },
                { value: null, label: "Skip" },
              ] as const
            ).map((item) => {
              const active = gender === item.value;
              return (
                <Pressable
                  key={item.label}
                  onPress={() => {
                    setGender(item.value);
                    setGenderOpen(false);
                  }}
                  style={[s.genderOption, active && s.genderOptionOn]}
                >
                  <Text style={[s.genderOptionText, active && s.genderOptionTextOn]}>{item.label}</Text>
                  {active ? <Text style={s.genderOptionBadge}>Selected</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal visible={ageOpen} transparent animationType="fade" onRequestClose={() => setAgeOpen(false)}>
        <View style={s.ageModalWrap}>
          <Pressable style={s.ageBackdrop} onPress={() => setAgeOpen(false)} />
          <View style={s.ageSheet}>
            <View style={s.ageSheetGlow} />
            <Text style={s.ageSheetTitle}>Select age</Text>
            <Text style={s.ageSheetSub}>Kristo is for ages 14 and up</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={s.ageScroll}
              contentContainerStyle={s.ageScrollContent}
            >
              {AGE_OPTIONS.map((value) => {
                const active = age === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setAge(value);
                      setAgeOpen(false);
                      if (value < MIN_AGE) {
                        setErr("Kristo requires age 14+");
                      } else {
                        setErr(null);
                      }
                    }}
                    style={[s.ageOption, active && s.ageOptionOn]}
                  >
                    <Text style={[s.ageOptionText, active && s.ageOptionTextOn]}>{value}</Text>
                    {active ? <Text style={s.ageOptionBadge}>Selected</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={phoneOpen} transparent animationType="fade" onRequestClose={() => setPhoneOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.phoneModalWrap}
        >
          <Pressable style={s.phoneBackdrop} onPress={() => setPhoneOpen(false)} />

          <View style={s.phoneSheet}>
            <Text style={s.phoneSheetTitle}>Phone number (Optional)</Text>

            <View style={s.phoneSheetRow}>
              <View style={s.phoneSheetCode}>
                <Text style={s.phoneSheetCodeText}>{country.dialCode || "—"}</Text>
              </View>

              <TextInput
                value={phoneLocal}
                onChangeText={setPhoneLocal}
                autoFocus
                keyboardType="phone-pad"
                returnKeyType="default"
                onSubmitEditing={() => setPhoneOpen(false)}
                placeholder="Enter phone number"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={s.phoneSheetInput}
              />
            </View>

            <Pressable onPress={() => setPhoneOpen(false)} style={s.phoneDoneBtn}>
              <Text style={s.phoneDoneText}>Done</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  titleWrap: { position: "relative", marginBottom: 0 },

  titleGlow: {
    position: "absolute",
    top: -10,
    left: -20,
    right: -20,
    height: 48,
    borderRadius: 40,
    backgroundColor: "rgba(244,201,93,0.08)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.25,
    shadowRadius: 22,
  },

  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: 0 },
  brandDot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.16)", borderWidth: 1.2, borderColor: "rgba(244,201,93,0.55)", shadowColor: "#F4C95D", shadowOpacity: 0.35, shadowRadius: 12 },
  brandDotText: { color: GOLD, fontWeight: "900" },
  brandText: { color: GOLD, fontWeight: "900", marginLeft: 10, letterSpacing: 0.8, fontSize: 15 },
  wrap: { flex: 1, backgroundColor: "#05070D" },
  content: {
    paddingHorizontal: 12,
    paddingTop: 40,
    paddingBottom: 32,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  title: { color: "white", fontSize: 34, fontWeight: "900", letterSpacing: -1.2 },
  sub: { color: MUTED, marginTop: 4, fontWeight: "800", lineHeight: 18, fontSize: 13 },
  card: {
    marginTop: 14,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    backgroundColor: "rgba(10,14,24,0.82)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.24)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  label: { color: MUTED, fontWeight: "900", fontSize: 12, letterSpacing: 0.35 },
  labelGap: { color: MUTED, fontWeight: "900", fontSize: 12, letterSpacing: 0.35, marginTop: 11 },
  nameRow: { position: "relative", flexDirection: "row", alignItems: "center" },
  nameInput: { flex: 1, paddingRight: 112 },
  input: { marginTop: 6, minHeight: 50, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", borderRadius: 19, paddingHorizontal: 15, color: "white", fontWeight: "900", backgroundColor: "rgba(255,255,255,0.035)" },
  selectCard: { marginTop: 6, minHeight: 50, borderWidth: 1.1, borderColor: "rgba(244,201,93,0.48)", borderRadius: 20, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(244,201,93,0.10)" },
  countrySelectCard: {
    marginTop: 6,
    minHeight: 50,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  countryChangeHint: {
    color: "rgba(147,197,253,0.9)",
    fontWeight: "800",
    fontSize: 12,
  },
  flag: { fontSize: 20, marginRight: 10 },
  selectText: { flex: 1, color: "white", fontWeight: "900", fontSize: 16 },
  chevron: { color: GOLD, fontWeight: "900", fontSize: 18 },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.58)" },
  countrySheet: { maxHeight: "72%", margin: 14, borderRadius: 28, padding: 14, backgroundColor: "rgba(12,16,25,0.98)", borderWidth: 1, borderColor: "rgba(217,179,95,0.28)" },
  countrySearchInput: {
    marginTop: 10,
    marginBottom: 8,
    minHeight: 46,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    paddingHorizontal: 14,
    color: "white",
    fontWeight: "800",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  countrySearchEmpty: {
    color: MUTED,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
  countryOptionTextWrap: { flex: 1 },
  countryOptionMeta: {
    color: "rgba(255,255,255,0.45)",
    fontWeight: "800",
    fontSize: 11,
    marginTop: 2,
  },
  sheetHandle: { alignSelf: "center", width: 42, height: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.22)", marginBottom: 12 },
  sheetTitle: { color: "white", fontWeight: "900", fontSize: 18, marginBottom: 0 },
  sheetOption: { minHeight: 46, borderRadius: 16, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", marginBottom: 6, backgroundColor: "rgba(255,255,255,0.035)" },
  sheetOptionOn: { backgroundColor: "rgba(217,179,95,0.16)", borderWidth: 1, borderColor: "rgba(217,179,95,0.34)" },
  flagSmall: { fontSize: 19, marginRight: 10 },
  countryName: { color: MUTED, fontWeight: "900", fontSize: 16 },
  countryNameOn: { color: GOLD },

  passwordCard: { marginTop: 10, minHeight: 64, borderRadius: 22, paddingHorizontal: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(217,179,95,0.13)", borderWidth: 1.2, borderColor: "rgba(217,179,95,0.45)" },
  passwordCardBlue: { backgroundColor: "rgba(79,140,255,0.12)", borderColor: "rgba(79,140,255,0.45)" },
  passwordCardDone: { backgroundColor: "rgba(217,179,95,0.22)", borderColor: "rgba(244,201,93,0.8)" },
  passwordCardDoneBlue: { backgroundColor: "rgba(79,140,255,0.20)", borderColor: "rgba(132,176,255,0.85)" },
  passwordCardLabel: { color: "rgba(255,255,255,0.68)", fontWeight: "900", fontSize: 11, letterSpacing: 0.4 },
  passwordCardValue: { color: "white", fontWeight: "900", fontSize: 15, marginTop: 4 },
  passwordCardIcon: { color: "#F4C95D", fontWeight: "900", fontSize: 24 },
  passwordPanelGold: { marginTop: 7, borderRadius: 22, padding: 10, backgroundColor: "rgba(36,29,12,0.96)", borderWidth: 1.2, borderColor: "rgba(244,201,93,0.62)" },
  passwordPanelBlue: {
    marginTop: 8,
    borderRadius: 20,
    padding: 8,
    backgroundColor: "rgba(8,17,36,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(79,140,255,0.72)",
  },
  passwordInputVip: {
    width: "100%",
    alignSelf: "stretch",
    minHeight: 48,
    height: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 0,
    color: "white",
    fontWeight: "900",
    fontSize: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
  },
  passwordInputVipGap: { marginTop: 8 },
  passwordHint: {
    marginTop: 6,
    color: "rgba(255,255,255,0.52)",
    fontWeight: "700",
    fontSize: 11,
    lineHeight: 15,
  },
  passwordHintWarn: {
    marginTop: 4,
    color: "#ffb4b4",
    fontWeight: "800",
    fontSize: 11,
    lineHeight: 15,
  },
  passwordActions: { marginTop: 7, flexDirection: "row", gap: 8 },
  passwordMiniBtn: { flex: 1, height: 38, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  passwordMiniBtnBlue: { flex: 1, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  passwordMiniText: { color: "white", fontWeight: "900" },
  passwordSaveBtn: { flex: 1.35, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.92)" },
  passwordSaveBtnBlue: { flex: 1.35, height: 38, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(132,176,255,0.95)" },
  passwordSaveText: { color: "#07101B", fontWeight: "900" },


  emailPasswordRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    width: "100%",
    flexWrap: "nowrap",
  },
  emailHalfInput: { flex: 1, flexShrink: 1, minWidth: 0, marginTop: 0 },
  passwordHalfCard: {
    width: 148,
    minWidth: 132,
    maxWidth: 200,
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 50,
    borderRadius: 19,
    paddingHorizontal: 12,
    justifyContent: "center",
    backgroundColor: "rgba(59,130,246,0.18)",
    borderWidth: 1.3,
    borderColor: "rgba(96,165,250,0.9)",
    overflow: "hidden",
  },
  passwordHalfDone: { backgroundColor: "rgba(59,130,246,0.28)", borderColor: "rgba(147,197,253,0.98)" },
  passwordHalfLabel: {
    color: "rgba(255,255,255,0.68)",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 0.2,
  },
  passwordHalfValue: {
    color: "white",
    fontWeight: "900",
    fontSize: 13,
    marginTop: 3,
    flexShrink: 1,
  },

  phoneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  codeBox: { marginTop: 6, borderWidth: 1, borderColor: "rgba(217,179,95,0.4)", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "rgba(217,179,95,0.08)" },
  codeText: { color: GOLD, fontWeight: "900" },
  phoneSelect: { justifyContent: "center" },
  phoneSelectText: { color: "white", fontWeight: "900", fontSize: 14 },
  phoneSelectPlaceholder: { color: "rgba(255,255,255,0.35)" },
  phoneModalWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 34 },
  phoneBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)" },
  phoneSheet: { borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#080C14", borderWidth: 1.4, borderColor: "rgba(244,201,93,0.58)", shadowColor: "#F4C95D", shadowOpacity: 0.42, shadowRadius: 24, shadowOffset: { width: 0, height: 14 } },
  phoneSheetTitle: { color: "white", fontWeight: "900", fontSize: 15, marginBottom: 8, textAlign: "center" },
  phoneSheetRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  phoneSheetCode: { height: 40, minWidth: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.13)", borderWidth: 1, borderColor: "rgba(244,201,93,0.45)" },
  phoneSheetCodeText: { color: "#F4C95D", fontWeight: "900", fontSize: 15 },
  phoneSheetInput: { flex: 1, height: 40, borderRadius: 18, paddingHorizontal: 14, color: "white", fontWeight: "900", backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  phoneDoneBtn: { marginTop: 8, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.88)" },
  phoneDoneText: { color: "#081018", fontWeight: "900", fontSize: 15 },
  phoneInput: { flex: 1 },
  idBox: { marginTop: 8, borderRadius: 22, padding: 15, backgroundColor: "rgba(244,201,93,0.14)", borderWidth: 1.2, borderColor: "rgba(244,201,93,0.58)", shadowColor: "#F4C95D", shadowOpacity: 0.42, shadowRadius: 22 },
  idText: { color: "white", fontWeight: "900", fontSize: 17, letterSpacing: 0.8 },
  idSub: { color: GOLD, fontWeight: "900", marginTop: 2, fontSize: 11 },
  notice: { borderWidth: 1, borderColor: "rgba(217,179,95,0.35)", borderRadius: 18, padding: 14, backgroundColor: "rgba(217,179,95,0.08)", marginBottom: 14 },
  noticeTitle: { color: GOLD, fontWeight: "900", marginBottom: 6, letterSpacing: 1.2 },
  noticeBig: { color: "white", fontWeight: "900", fontSize: 22, marginBottom: 6 },
  noticeText: { color: "white", fontWeight: "900", marginTop: 2, lineHeight: 20 },
  err: { color: "#ff7b7b", fontWeight: "900", marginBottom: 12 },
  splitBtn: {
    marginTop: 16,
    minHeight: 70,
    borderRadius: 24,
    flexDirection: "row",
    overflow: "hidden",
    gap: 2,
    backgroundColor: "rgba(255,255,255,0.04)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  splitGender: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    backgroundColor: "rgba(88,52,140,0.92)",
    borderWidth: 1.1,
    borderColor: "rgba(192,132,252,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  splitGenderSmall: {
    color: "rgba(233,213,255,0.82)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  splitGenderText: {
    color: "#F5E6FF",
    fontWeight: "900",
    fontSize: 13,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 2,
  },
  splitAge: {
    flex: 1,
    backgroundColor: "rgba(18,24,36,0.98)",
    borderWidth: 1.1,
    borderColor: "rgba(244,201,93,0.22)",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  splitSmall: {
    color: "rgba(244,201,93,0.72)",
    fontSize: 11,
    fontWeight: "900",
  },
  splitAgeText: {
    color: "rgba(255,255,255,0.88)",
    fontWeight: "900",
    fontSize: 14,
    lineHeight: 17,
    textAlign: "center",
  },
  splitSend: {
    flex: 1.35,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  splitSendActive: {
    backgroundColor: "rgba(244,201,93,0.95)",
    borderWidth: 1.1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  splitSendDisabled: {
    backgroundColor: "rgba(244,201,93,0.28)",
    borderWidth: 1.1,
    borderColor: "rgba(244,201,93,0.18)",
  },
  splitSendText: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 13,
    lineHeight: 16,
    textAlign: "center",
  },
  splitSendTextDisabled: {
    color: "rgba(11,15,23,0.55)",
  },
  genderModalWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  genderBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)" },
  genderSheet: {
    width: "72%",
    borderRadius: 26,
    padding: 14,
    backgroundColor: "rgba(14,10,24,0.98)",
    borderWidth: 1.2,
    borderColor: "rgba(192,132,252,0.58)",
    shadowColor: "#C084FC",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  genderSheetTitle: { color: "#F5E6FF", fontWeight: "900", fontSize: 17, textAlign: "center" },
  genderSheetSub: {
    color: "rgba(233,213,255,0.62)",
    fontWeight: "800",
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 10,
  },
  genderOption: {
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(192,132,252,0.2)",
  },
  genderOptionOn: {
    backgroundColor: "rgba(88,52,140,0.35)",
    borderColor: "rgba(192,132,252,0.55)",
  },
  genderOptionText: { color: "rgba(255,255,255,0.78)", fontWeight: "900", fontSize: 16 },
  genderOptionTextOn: { color: "#E9D5FF" },
  genderOptionBadge: { color: "#C084FC", fontWeight: "900", fontSize: 11 },
  ageHint: {
    marginTop: 6,
    color: "rgba(255,255,255,0.48)",
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  ageModalWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  ageBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)" },
  ageSheet: {
    width: "78%",
    maxHeight: "58%",
    borderRadius: 26,
    padding: 14,
    backgroundColor: "rgba(8,12,20,0.98)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.58)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    overflow: "hidden",
  },
  ageSheetGlow: {
    position: "absolute",
    top: -40,
    left: -20,
    right: -20,
    height: 90,
    backgroundColor: "rgba(244,201,93,0.08)",
  },
  ageSheetTitle: { color: "white", fontWeight: "900", fontSize: 17, textAlign: "center" },
  ageSheetSub: {
    color: "rgba(255,255,255,0.62)",
    fontWeight: "800",
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 10,
  },
  ageScroll: { maxHeight: 320 },
  ageScrollContent: { paddingBottom: 8 },
  ageOption: {
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  ageOptionOn: {
    backgroundColor: "rgba(244,201,93,0.16)",
    borderColor: "rgba(244,201,93,0.55)",
  },
  ageOptionText: { color: "rgba(255,255,255,0.78)", fontWeight: "900", fontSize: 16 },
  ageOptionTextOn: { color: "#F4C95D" },
  ageOptionBadge: { color: "#F4C95D", fontWeight: "900", fontSize: 11 },
  btn: { marginTop: 16, borderRadius: 22, paddingVertical: 15, alignItems: "center", backgroundColor: "rgba(244,201,93,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)", shadowColor: "#F4C95D", shadowOpacity: 0.7, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
  btnText: { color: "#0B0F17", fontWeight: "900", fontSize: 15 },

  linkBtn: { marginTop: 8, paddingVertical: 8, alignItems: "center" },
  linkText: { color: "rgba(255,255,255,0.75)", fontWeight: "900" },
}
);
