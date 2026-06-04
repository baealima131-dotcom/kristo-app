import React, { useMemo, useState, useEffect } from "react";
import { useRouter, Href } from "expo-router";
import { Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { loadProfileDraft } from "@/src/lib/profileStore";
import { loadChurchDraft } from "@/src/lib/churchStore";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { resolveActiveChurchFromProfileResponse } from "@/src/lib/churchMembershipSync";
import { recoverChurchIdFromMembership } from "@/src/lib/churchLockedRecovery";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.65)";
const BORDER = "rgba(255,255,255,0.10)";

export default function LoginScreen() {
  const router = useRouter();
  const { setSession } = useKristoSession();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetContact, setResetContact] = useState("");
  const [resetStep, setResetStep] = useState(1);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loginStage, setLoginStage] = useState(false);

  useEffect(() => {
    if (retryAfter <= 0) return;

    const t = setInterval(() => {
      setRetryAfter((sec) => Math.max(0, sec - 1));
    }, 1000);

    return () => clearInterval(t);
  }, [retryAfter]);

  const locked = retryAfter > 0;
  const retryLabel = `${Math.floor(retryAfter / 60)}:${String(retryAfter % 60).padStart(2, "0")}`;

  const can = useMemo(() => {
    return userId.trim().length >= 3 && password.length >= 8 && !saving && !locked;
  }, [userId, password, saving, locked]);

  function onForgotPasswordPress() {
    console.log("KRISTO_FORGOT_PASSWORD_OPENED");
    setResetErr(null);
    setResetStep(1);
    setResetContact("");
    setResetCode("");
    setNewPassword("");
    setChallengeId("");
    setForgotOpen(true);
  }

  async function requestPasswordResetCode() {
    const contact = resetContact.trim();
    if (contact.length < 3) {
      setResetErr("Enter your email address.");
      return;
    }

    if (!contact.includes("@")) {
      setResetErr("Password reset by phone is not available. Please use your email address.");
      return;
    }

    setResetErr(null);
    console.log("KRISTO_FORGOT_PASSWORD_REQUEST", { hasAt: true });

    try {
      const data = await apiPost("/api/auth/reset-password", {
        step: "start",
        identifierType: "email",
        identifier: contact,
      });

      if (!data?.ok) {
        const retryAfter = Number(data?.retryAfter || 0);
        console.log("KRISTO_FORGOT_PASSWORD_FAILED", {
          error: data?.error || "request_failed",
          retryAfter: retryAfter || undefined,
        });
        setResetErr(
          retryAfter > 0
            ? "Too many reset requests. Please wait and try again."
            : data?.error || "We could not send a reset code. Please try again later."
        );
        return;
      }

      const nextChallengeId = String(data?.challengeId || "").trim();
      if (!nextChallengeId) {
        console.log("KRISTO_FORGOT_PASSWORD_SENT", { delivered: false });
        setForgotOpen(false);
        setResetStep(1);
        setResetContact("");
        setErr(null);
        setInfo(
          String(data?.message || "").trim() ||
            "If an account exists with this email, we sent a reset code. Check your inbox."
        );
        return;
      }

      console.log("KRISTO_FORGOT_PASSWORD_SENT", { delivered: true, challengeId: nextChallengeId });
      setChallengeId(nextChallengeId);
      setResetStep(2);
      setErr(null);
      setInfo(String(data?.message || "").trim() || "We sent a password reset code to your email.");
    } catch {
      console.log("KRISTO_FORGOT_PASSWORD_FAILED", { error: "network_exception" });
      setResetErr("We could not reach the server. Check your connection and try again.");
    }
  }

  async function submitPasswordReset() {
    const code = resetCode.trim();
    const pwd = newPassword;

    if (code.length < 4) {
      setResetErr("Enter the reset code from your email.");
      return;
    }
    if (pwd.length < 8) {
      setResetErr("New password must be at least 8 characters.");
      return;
    }

    setResetErr(null);

    try {
      const data = await apiPost("/api/auth/reset-password", {
        step: "verify",
        challengeId,
        code,
        newPassword: pwd,
      });

      if (!data?.ok) {
        console.log("KRISTO_FORGOT_PASSWORD_FAILED", { error: data?.error || "verify_failed", step: "verify" });
        setResetErr(data?.error || "Reset failed. Check your code and try again.");
        return;
      }

      setForgotOpen(false);
      setResetStep(1);
      setResetContact("");
      setResetCode("");
      setNewPassword("");
      setChallengeId("");
      setResetErr(null);
      setErr(null);
      setInfo("Your password was reset. Sign in with your new password.");
    } catch {
      console.log("KRISTO_FORGOT_PASSWORD_FAILED", { error: "network_exception", step: "verify" });
      setResetErr("We could not reach the server. Check your connection and try again.");
    }
  }

  async function onLogin() {
    if (!can) return;
    setErr(null);
    setRetryAfter(0);
    Keyboard.dismiss();
    setSaving(true);

    try {
      const data = await apiPost("/api/auth/signin", {
        email: userId.trim(),
        password,
      });

      if (!data?.ok) {
        const nextRetry = Number(data?.retryAfter || 0);
        if (nextRetry > 0) {
          setRetryAfter(nextRetry);
          setErr("");
        } else {
          setErr(data?.error || "Wrong email/phone or password.");
        }
        return;
      }

      const finalUserId = String(data.userId || "").trim();
      if (!finalUserId) {
        setErr("Login failed. Missing user id.");
        return;
      }

      const profileRes: any = await apiGet("/api/auth/profile", {
        headers: getKristoHeaders({ userId: finalUserId, role: "Member", churchId: "" }),
      });

      const p = profileRes?.profile;
      const resolvedChurch = resolveActiveChurchFromProfileResponse(profileRes);
      let serverChurchId = resolvedChurch.churchId;
      let serverRole = serverChurchId ? resolvedChurch.role : "Member";

      const publicKristoId = String(
        data.kristoId ||
          data.publicKristoId ||
          p?.userCode ||
          ""
      ).trim();

      const draft = await loadProfileDraft(finalUserId);
      const churchDraft = await loadChurchDraft(finalUserId);

      let sessionChurchId = serverChurchId || String(churchDraft?.churchId || "").trim();
      let sessionRole = sessionChurchId
        ? serverRole
        : String(churchDraft?.role || serverRole || "Member");

      const fullName = String(p?.fullName || draft?.displayName || data.name || data.fullName || "");

      const preSession = {
        userId: finalUserId,
        kristoId: publicKristoId,
        role: sessionRole,
        churchId: sessionChurchId,
        churchProfile: churchDraft?.churchProfile,
        churchName: churchDraft?.churchName || "",
        churchPhone: churchDraft?.churchPhone || "",
        churchCountry: churchDraft?.churchCountry || "",
        churchCity: churchDraft?.churchCity || "",
        name: fullName,
        displayName: fullName,
        email: String(p?.email || data.email || userId.trim()),
        phone: String(p?.phone || draft?.phone || data.phone || ""),
        city: String(p?.city || draft?.city || ""),
        country: String(p?.country || draft?.country || ""),
        avatarUri: String(p?.avatarUrl || draft?.avatarUri || ""),
        avatarUrl: String(p?.avatarUrl || draft?.avatarUri || ""),
      } as any;

      if (!sessionChurchId) {
        await setSession(preSession);
        const recovered = await recoverChurchIdFromMembership(preSession, setSession);
        if (recovered.churchId) {
          sessionChurchId = recovered.churchId;
          sessionRole = recovered.role;
        }
      }

      await setSession({
        ...preSession,
        role: sessionRole,
        churchId: sessionChurchId,
        churchRole: sessionRole,
      } as any);

      const hasProfile = Boolean(fullName.trim());

      const nextRoute = !hasProfile
        ? "/(tabs)/profile"
        : !sessionChurchId
          ? "/(tabs)/more/church"
          : "/(tabs)";

      setInfo(null);
      setLoginStage(true);

      setTimeout(() => {
        router.replace(nextRoute as Href);
      }, 2600);
    } catch {
      setErr("Login failed. Check server connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Kristo</Text>
      <Text style={s.sub}>Welcome back</Text>

      {locked ? <Text style={s.err}>Too many attempts. Please wait {retryLabel}</Text> : null}
      {!!err && !locked && <Text style={s.err}>{err}</Text>}
      {!!info && !err && !locked && <Text style={s.info}>{info}</Text>}

      {loginStage ? (
        <View style={s.loginOverlay}>
          <View style={s.loginGlow} />
          <View style={s.loginStageCard}>
            <Text style={s.loginStageTitle}>Welcome back</Text>
            <Text style={s.loginStageSub}>Preparing your Kristo space...</Text>
            <View style={s.loginDotsRow}>
              <View style={s.loginDot} />
              <View style={s.loginDot} />
              <View style={s.loginDot} />
            </View>
          </View>
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.label}>Email or phone number</Text>
        <TextInput
          value={userId}
          onChangeText={(v) => {
            setUserId(v);
            setErr(null);
            setRetryAfter(0);
          }}
          autoCapitalize="none"
          placeholder="Email or phone number"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <Text style={[s.label, { marginTop: 12 }]}>Password</Text>
        <View style={s.passwordWrap}>
          <TextInput
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setErr(null);
            }}
            editable={!locked}
            autoCapitalize="none"
            secureTextEntry={!showPassword}
            placeholder="Enter your password"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[s.input, s.passwordInput, { flex: 1 }]}
          />
          <Pressable onPress={() => setShowPassword(v => !v)} style={s.eyeBtn}>
            <Text style={s.eyeText}>{showPassword ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        <View style={s.forgotRow}>
          <Pressable onPress={onForgotPasswordPress} style={s.forgotBtn}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </Pressable>
        </View>

        <Pressable onPress={onLogin} disabled={!can} style={[s.btn, !can && { opacity: 0.5 }, locked && { opacity: 0.35 }]}>
          <Text style={s.btnText}>{saving ? "..." : "Sign in"}</Text>
        </Pressable>

        <Pressable onPress={() => router.push("/(auth)/signup" as Href)} style={s.linkBtn}>
          <Text style={s.linkText}>Create account (Sign up)</Text>
        </Pressable>
      </View>

      <Modal visible={forgotOpen} transparent animationType="fade" onRequestClose={() => setForgotOpen(false)}>
        <View style={s.modalWrap}>
          <Pressable style={s.modalBackdrop} onPress={() => setForgotOpen(false)} />

          <View style={s.resetCard}>
            {resetStep === 1 ? (
              <>
                <Text style={s.resetTitle}>Reset password</Text>
                <Text style={s.resetSub}>Enter your email. We will send a reset code to your inbox.</Text>

                {!!resetErr && <Text style={s.resetErrText}>{resetErr}</Text>}

                <TextInput
                  value={resetContact}
                  onChangeText={setResetContact}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  placeholder="Email address"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.resetInput}
                />

                <Pressable
                  disabled={resetContact.trim().length < 3}
                  onPress={requestPasswordResetCode}
                  style={[s.resetBtn, resetContact.trim().length < 3 && { opacity: 0.45 }]}
                >
                  <Text style={s.resetBtnText}>Send reset code</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={s.resetTitle}>Enter reset code</Text>
                <Text style={s.resetSub}>Enter the code from your email and choose a new password.</Text>

                {!!resetErr && <Text style={s.resetErrText}>{resetErr}</Text>}

                <TextInput
                  value={resetCode}
                  onChangeText={setResetCode}
                  placeholder="Reset code"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  keyboardType="number-pad"
                  textContentType="none"
                  autoComplete="off"
                  style={s.resetInput}
                />

                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  placeholder="New password"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.resetInput}
                />

                <Pressable
                  onPress={submitPasswordReset}
                  disabled={resetCode.trim().length < 4 || newPassword.length < 8}
                  style={[
                    s.resetBtn,
                    (resetCode.trim().length < 4 || newPassword.length < 8) && { opacity: 0.45 }
                  ]}
                >
                  <Text style={s.resetBtnText}>Reset password</Text>
                </Pressable>
              </>
            )}

            <Pressable
              onPress={() => {
                setForgotOpen(false);
                setResetStep(1);
                setResetContact("");
                setResetCode("");
                setNewPassword("");
                setChallengeId("");
                setResetErr(null);
              }}
              style={s.cancelBtn}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, padding: 16, paddingTop: 52 },
  title: { color: "white", fontSize: 32, fontWeight: "900", letterSpacing: 0.5, textShadowColor: "rgba(217,179,95,0.35)", textShadowRadius: 14 },
  sub: { color: MUTED, marginTop: 6, fontWeight: "700" },
  err: { color: "#ff7b7b", marginTop: 14, fontWeight: "800" },
  info: { color: "rgba(147,197,253,0.95)", marginTop: 10, fontWeight: "800" },

  card: { marginTop: 22, borderWidth: 1.2, borderColor: "rgba(217,179,95,0.18)", borderRadius: 24, padding: 16, backgroundColor: "rgba(255,255,255,0.035)" },
  label: { color: MUTED, fontWeight: "800", fontSize: 12, letterSpacing: 0.4 },
  input: { marginTop: 8, minHeight: 52, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingHorizontal: 14, color: "white", fontWeight: "900", backgroundColor: "rgba(255,255,255,0.025)" },
  passwordWrap: {
    marginTop: 8,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: "rgba(96,165,250,0.75)",
    backgroundColor: "rgba(59,130,246,0.10)",
    paddingLeft: 14,
    paddingRight: 12,
  },
  eyeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eyeText: {
    color: "rgba(147,197,253,0.95)",
    fontWeight: "900",
    fontSize: 12,
  },

  passwordInput: {
    marginTop: 0,
    minHeight: 52,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
  },

  rolesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: { borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.02)" },
  pillOn: { borderColor: "rgba(217,179,95,0.55)", backgroundColor: "rgba(217,179,95,0.12)" },
  pillText: { color: MUTED, fontWeight: "800", fontSize: 12 },
  pillTextOn: { color: GOLD },

  forgotRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  forgotBtn: { paddingVertical: 6, paddingLeft: 10 },
  forgotText: { color: "rgba(96,165,250,0.95)", fontWeight: "900", fontSize: 13 },

  btn: { marginTop: 10, borderRadius: 20, paddingVertical: 15, alignItems: "center", backgroundColor: "rgba(217,179,95,0.28)", borderWidth: 1.2, borderColor: "rgba(217,179,95,0.48)" },
  btnText: { color: GOLD, fontWeight: "900", letterSpacing: 0.2 },

  linkBtn: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  linkText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  loginOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,8,14,0.86)",
    paddingHorizontal: 24,
  },
  loginGlow: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(217,179,95,0.18)",
  },
  loginStageCard: {
    width: "100%",
    minHeight: 190,
    borderRadius: 32,
    paddingVertical: 34,
    paddingHorizontal: 22,
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.50)",
    backgroundColor: "rgba(11,15,23,0.98)",
    alignItems: "center",
    justifyContent: "center",
  },
  loginStageTitle: { color: GOLD, fontSize: 34, fontWeight: "900", letterSpacing: 0.3 },
  loginStageSub: { color: "rgba(255,255,255,0.76)", marginTop: 12, fontWeight: "900", fontSize: 16, textAlign: "center" },
  loginDotsRow: { flexDirection: "row", gap: 10, marginTop: 22 },
  loginDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD, opacity: 0.88 },

  modalWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  modalBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)" },
  resetCard: { borderRadius: 24, padding: 16, backgroundColor: "#0B0F17", borderWidth: 1.2, borderColor: "rgba(96,165,250,0.62)" },
  resetTitle: { color: "white", fontWeight: "900", fontSize: 20 },
  resetSub: { color: MUTED, fontWeight: "700", marginTop: 6, lineHeight: 18 },
  resetErrText: { color: "#ff7b7b", fontWeight: "800", marginTop: 10 },
  resetInput: { marginTop: 14, minHeight: 52, borderWidth: 1, borderColor: "rgba(96,165,250,0.65)", borderRadius: 18, paddingHorizontal: 14, color: "white", fontWeight: "900", backgroundColor: "rgba(59,130,246,0.08)" },
  resetBtn: { marginTop: 12, borderRadius: 18, paddingVertical: 14, alignItems: "center", backgroundColor: "rgba(96,165,250,0.9)" },
  resetBtnText: { color: "#07101B", fontWeight: "900" },
  cancelBtn: { marginTop: 8, paddingVertical: 10, alignItems: "center" },
  cancelText: { color: "rgba(255,255,255,0.72)", fontWeight: "900" },
});
