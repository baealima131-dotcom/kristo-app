import React, { useMemo, useState } from "react";
import { useRouter, Href } from "expo-router";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { saveProfileDraft } from "@/src/lib/profileStore";
import { apiGet, apiPost, getApiBase } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.65)";
const BORDER = "rgba(255,255,255,0.10)";

const COUNTRIES = [
  { name: "United States", code: "+1", flag: "🇺🇸" },
  { name: "Canada", code: "+1", flag: "🇨🇦" },
  { name: "Burundi", code: "+257", flag: "🇧🇮" },
  { name: "DR Congo", code: "+243", flag: "🇨🇩" },
  { name: "Tanzania", code: "+255", flag: "🇹🇿" },
  { name: "Kenya", code: "+254", flag: "🇰🇪" },
  { name: "Uganda", code: "+256", flag: "🇺🇬" },
  { name: "Rwanda", code: "+250", flag: "🇷🇼" },
  { name: "South Africa", code: "+27", flag: "🇿🇦" },
  { name: "United Kingdom", code: "+44", flag: "🇬🇧" },
  { name: "France", code: "+33", flag: "🇫🇷" },
];

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

export default function SignupScreen() {
  const router = useRouter();
  const { setSession } = useKristoSession();

  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [genderOpen, setGenderOpen] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [ageOpen, setAgeOpen] = useState(false);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [phoneLocal, setPhoneLocal] = useState("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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

  const phone = `${country.code} ${phoneLocal}`.trim();

  const canForm = useMemo(() => {
    return (
      fullName.trim().length >= 2 &&
      !!gender &&
      !!age &&
      age >= MIN_AGE &&
      phoneLocal.trim().length >= 6 &&
      email.trim().includes("@") &&
      password.length >= 8 &&
      confirmPassword.length >= 8 &&
      password === confirmPassword &&
      address.trim().length >= 3 &&
      city.trim().length >= 2 &&
      !saving
    );
  }, [fullName, gender, age, phoneLocal, email, password, confirmPassword, address, city, saving]);

  const canVerify =
    emailInput.trim().length >= 4 &&
    !!signupChallengeId &&
    !saving;

  async function sendVerification() {
    if (!age || age < MIN_AGE) {
      setErr("Kristo requires age 14+");
      return;
    }
    if (!canForm) return;
    setErr(null);
    setVerifyInfo(null);
    setSaving(true);

    try {
      const data = await apiPost("/api/auth/sign-up", {
        email: email.trim(),
        phone,
        password,
        fullName: fullName.trim(),
        gender: gender === "M" ? "MALE" : "FEMALE",
        age,
        dob: dobFromAge(age),
        country: country.name,
        city: city.trim(),
      });

      if (!data?.ok) {
        const serverError = String(data?.error || "").trim();
        const reason = String(data?.reason || "").trim();
        const status = typeof data?.status === "number" ? ` (HTTP ${data.status})` : "";
        const detail = [serverError, reason && reason !== "http_error" ? `Reason: ${reason}` : ""]
          .filter(Boolean)
          .join(" ");
        setErr(
          detail ||
            `Could not send verification code${status}. API: ${getApiBase()}`
        );
        if (__DEV__) {
          console.warn("[KRISTO SIGNUP] sign-up failed", { data, apiBase: getApiBase() });
        }
        return;
      }

      setCreatedUserId(String(data.userId || "").trim());
      setPublicKristoId(
        String(data.kristoId || data.publicKristoId || "").trim()
      );
      setSignupChallengeId(data.challengeId || "");
      const devOtp =
        __DEV__ && typeof data?.devOtp === "string" && data.devOtp.trim()
          ? data.devOtp.trim()
          : "";
      if (devOtp) {
        setVerifyInfo(`Dev OTP code: ${devOtp}`);
        setEmailInput(devOtp);
      } else {
        setVerifyInfo("We sent a verification code to your email.");
        setEmailInput("");
      }
      setStep("verify");
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

    setErr(null);

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

      const profileRes: any = await apiGet("/api/auth/profile", {
        headers: getKristoHeaders({ userId: finalUserId, role: "Member", churchId: "" }),
      });

      if (!profileRes?.ok) {
        const message = String(profileRes?.error || "Account verified but server profile is unavailable.");
        setErr(`${message} Try signing in with your email and password.`);
        if (__DEV__) {
          console.warn("[KRISTO SIGNUP] durable profile load failed after verify", profileRes);
        }
        return;
      }

      const p = profileRes?.profile;
      const kristoId = String(
        publicKristoId || p?.userCode || ""
      ).trim();

      const finalName = String(p?.fullName || fullName.trim());
      const profileGender = gender === "M" ? "MALE" : gender === "F" ? "FEMALE" : undefined;

      const profileData = await apiPost(
        "/api/auth/profile",
        {
          userCode: kristoId,
          fullName: finalName,
          phone,
          email: email.trim(),
          country: country.name,
          city: city.trim(),
          gender: profileGender,
          dob: age ? dobFromAge(age) : undefined,
        },
        getKristoHeaders({ userId: finalUserId, role: "Member", churchId: "" })
      );

      if (!profileData?.ok) {
        const message = formatProfileError(profileData, "Could not save your profile. Please try again.");
        if (__DEV__) {
          console.warn("[KRISTO SIGNUP] profile save failed", profileData);
        }
        Alert.alert("Profile save failed", message);
        setErr(message);
        return;
      }

      if (!data?.user?.id && !createdUserId) {
        setErr("Verification succeeded but durable account id is missing.");
        return;
      }

      await setSession({
        userId: finalUserId,
        kristoId,
        role: "Member",
        churchId: "",
        name: finalName,
        displayName: finalName,
        gender,
        phone,
        email: email.trim(),
        address: address.trim(),
        city: city.trim(),
        country: country.name,
        age: age ?? undefined,
      } as any);

      await saveProfileDraft({
        userId: finalUserId,
        kristoId,
        displayName: finalName,
        bio: "",
        avatarUri: undefined,
        phone,
        email: email.trim(),
        address: address.trim(),
        city: city.trim(),
        country: country.name,
        gender,
        age: age ?? undefined,
      }, finalUserId);

      router.replace("/(tabs)");
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
                style={[s.passwordHalfCard, password.length >= 8 && password === confirmPassword && s.passwordHalfDone]}
              >
                <Text style={s.passwordHalfLabel}>Password</Text>
                <Text style={s.passwordHalfValue}>
                  {password.length >= 8 && password === confirmPassword ? "Saved" : "Password"}
                </Text>
              </Pressable>
            </View>

            {passwordOpen ? (
              <View style={s.passwordPanelBlue}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create password"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  style={s.passwordInputVip}
                />
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  style={[s.passwordInputVip, { marginTop: 8 }]}
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
                      if (password.length >= 8 && password === confirmPassword) setPasswordOpen(false);
                    }}
                    style={[s.passwordSaveBtnBlue, (password.length < 8 || password !== confirmPassword) && { opacity: 0.45 }]}
                  >
                    <Text style={s.passwordSaveText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Text style={s.labelGap}>Address</Text>
            <TextInput value={address} onChangeText={setAddress} placeholder="Street address" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />

            <Text style={s.labelGap}>City</Text>
            <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />

            <Text style={s.labelGap}>Country</Text>
            <Pressable onPress={() => setCountryOpen((v) => !v)} style={s.selectCard}>
              <Text style={s.flag}>{country.flag}</Text>
              <Text style={s.selectText}>{country.name}</Text>
              <Text style={s.chevron}>{countryOpen ? "⌃" : "⌄"}</Text>
            </Pressable>



            <Text style={s.labelGap}>Phone number</Text>
            <View style={s.phoneRow}>
              <View style={s.codeBox}>
                <Text style={s.codeText}>{country.code}</Text>
              </View>
              <Pressable onPress={() => setPhoneOpen(true)} style={[s.input, s.phoneInput, s.phoneSelect]}>
                <Text style={[s.phoneSelectText, !phoneLocal.trim() && s.phoneSelectPlaceholder]}>
                  {phoneLocal.trim() || "Tap to enter phone number"}
                </Text>
              </Pressable>
            </View>

            <View style={[s.splitBtn, !canForm && { opacity: 0.45 }]}>
              <Pressable
                onPress={() => {
                  setGenderOpen(true);
                  setAgeOpen(false);
                }}
                style={s.splitGender}
              >
                <Text style={s.splitSmall}>Gender</Text>
                <Text style={s.splitGenderText}>{gender || "Select"}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setAgeOpen(true);
                  setGenderOpen(false);
                }}
                style={s.splitAge}
              >
                <Text style={s.splitSmall}>Age</Text>
                <Text style={s.splitGenderText}>{age ? `Age ${age}` : "Select"}</Text>
              </Pressable>

              <Pressable onPress={sendVerification} disabled={!canForm} style={s.splitSend}>
                <Text style={s.splitSendText}>{saving ? "Sending..." : "Send code"}</Text>
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
              <Text style={verifyInfo?.startsWith("Dev OTP") ? s.devOtpInfo : s.noticeText}>
                {verifyInfo || "We sent a verification code to your email."}
              </Text>
            </View>

            <Text style={s.label}>Verification code</Text>
            <TextInput
              value={emailInput}
              onChangeText={setEmailInput}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="Enter the code from your email"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={s.input}
            />

            <Pressable onPress={onCreate} disabled={!canVerify} style={[s.btn, !canVerify && { opacity: 0.45 }]}>
              <Text style={s.btnText}>{saving ? "Verifying..." : "Confirm & Create account"}</Text>
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
      <Modal visible={countryOpen} transparent animationType="fade" onRequestClose={() => setCountryOpen(false)}>
        <View style={s.modalWrap}>
          <Pressable style={s.modalBackdrop} onPress={() => setCountryOpen(false)} />

          <View style={s.countrySheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select country</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {COUNTRIES.map((c) => {
                const active = c.name === country.name;
                return (
                  <Pressable
                    key={c.name}
                    onPress={() => {
                      setCountry(c);
                      setCountryOpen(false);
                    }}
                    style={[s.sheetOption, active && s.sheetOptionOn]}
                  >
                    <Text style={s.flagSmall}>{c.flag}</Text>
                    <Text style={[s.countryName, active && s.countryNameOn]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
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

      <Modal visible={genderOpen} transparent animationType="fade" onRequestClose={() => setGenderOpen(false)}>
        <View style={s.genderModalWrap}>
          <Pressable style={s.genderBackdrop} onPress={() => setGenderOpen(false)} />
          <View style={s.genderSheet}>
            <Text style={s.genderSheetTitle}>Select gender</Text>

            {(["M", "F"] as const).map((g) => (
              <Pressable
                key={g}
                onPress={() => {
                  setGender(g);
                  setGenderOpen(false);
                }}
                style={[s.genderSheetOption, gender === g && s.genderSheetOptionOn]}
              >
                <Text style={[s.genderSheetText, gender === g && s.genderSheetTextOn]}>
                  {g === "M" ? "Male" : "Female"}
                </Text>
              </Pressable>
            ))}
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
            <Text style={s.phoneSheetTitle}>Phone number</Text>

            <View style={s.phoneSheetRow}>
              <View style={s.phoneSheetCode}>
                <Text style={s.phoneSheetCodeText}>{country.code}</Text>
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
  content: { paddingHorizontal: 12, paddingTop: 40, paddingBottom: 32 },
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
  flag: { fontSize: 20, marginRight: 10 },
  selectText: { flex: 1, color: "white", fontWeight: "900", fontSize: 16 },
  chevron: { color: GOLD, fontWeight: "900", fontSize: 18 },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.58)" },
  countrySheet: { maxHeight: "52%", margin: 14, borderRadius: 28, padding: 14, backgroundColor: "rgba(12,16,25,0.98)", borderWidth: 1, borderColor: "rgba(217,179,95,0.28)" },
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
    height: 42,
    borderRadius: 16,
    paddingHorizontal: 13,
    color: "white",
    fontWeight: "900",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
  },
  passwordActions: { marginTop: 7, flexDirection: "row", gap: 8 },
  passwordMiniBtn: { flex: 1, height: 38, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  passwordMiniBtnBlue: { flex: 1, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  passwordMiniText: { color: "white", fontWeight: "900" },
  passwordSaveBtn: { flex: 1.35, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.92)" },
  passwordSaveBtnBlue: { flex: 1.35, height: 38, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(132,176,255,0.95)" },
  passwordSaveText: { color: "#07101B", fontWeight: "900" },


  emailPasswordRow: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 10 },
  emailHalfInput: { flex: 1.65, marginTop: 0 },
  passwordHalfCard: { flex: 0.62, minHeight: 50, borderRadius: 19, paddingHorizontal: 10, justifyContent: "center", backgroundColor: "rgba(59,130,246,0.18)", borderWidth: 1.3, borderColor: "rgba(96,165,250,0.9)" },
  passwordHalfDone: { backgroundColor: "rgba(59,130,246,0.28)", borderColor: "rgba(147,197,253,0.98)" },
  passwordHalfLabel: { color: "rgba(255,255,255,0.68)", fontWeight: "900", fontSize: 10 },
  passwordHalfValue: { color: "white", fontWeight: "900", fontSize: 13, marginTop: 3 },

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
  devOtpInfo: { color: "rgba(147,197,253,0.95)", fontWeight: "900", marginTop: 2, lineHeight: 20 },
  err: { color: "#ff7b7b", fontWeight: "900", marginBottom: 12 },
  splitBtn: {
    position: "relative",
    marginTop: 16,
    minHeight: 70,
    borderRadius: 24,
    flexDirection: "row",
    overflow: "visible",
    backgroundColor: "rgba(244,201,93,0.85)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  splitGender: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    backgroundColor: "rgba(18,24,36,0.98)",
    borderWidth: 1.1,
    borderColor: "rgba(244,201,93,0.22)",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  splitAge: {
    flex: 1,
    backgroundColor: "rgba(18,24,36,0.98)",
    borderTopWidth: 1.1,
    borderBottomWidth: 1.1,
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
  splitGenderText: {
    color: "rgba(255,255,255,0.88)",
    fontWeight: "900",
    fontSize: 14,
    lineHeight: 17,
    textAlign: "center",
  },
  splitSend: {
    flex: 1.65,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    backgroundColor: "#D9B35F",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  splitSendText: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 14,
    lineHeight: 17,
    textAlign: "center",
  },
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

  genderActionMenu: { position: "absolute", left: 18, bottom: 66, width: 150, borderRadius: 22, overflow: "hidden", backgroundColor: "#080C14", borderWidth: 1.4, borderColor: "rgba(244,201,93,0.7)", zIndex: 999, elevation: 30, shadowColor: "#F4C95D", shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  genderActionOption: { height: 48, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.035)" },
  genderActionOptionOn: { backgroundColor: "rgba(244,201,93,0.18)" },
  genderActionText: { color: "white", fontWeight: "900", fontSize: 16 },
  genderActionTextOn: { color: "#F4C95D" },

  genderModalWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  genderBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)" },
  genderSheet: { width: "74%", borderRadius: 24, padding: 14, backgroundColor: "#080C14", borderWidth: 1.2, borderColor: "rgba(244,201,93,0.58)", shadowColor: "#F4C95D", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  genderSheetTitle: { color: "white", fontWeight: "900", fontSize: 16, marginBottom: 8, textAlign: "center" },
  genderSheetOption: { height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 7, backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  genderSheetOptionOn: { backgroundColor: "rgba(244,201,93,0.16)", borderColor: "rgba(244,201,93,0.55)" },
  genderSheetText: { color: "rgba(255,255,255,0.78)", fontWeight: "900", fontSize: 15 },
  genderSheetTextOn: { color: "#F4C95D" },
  linkBtn: { marginTop: 8, paddingVertical: 8, alignItems: "center" },
  linkText: { color: "rgba(255,255,255,0.75)", fontWeight: "900" },
}
);
