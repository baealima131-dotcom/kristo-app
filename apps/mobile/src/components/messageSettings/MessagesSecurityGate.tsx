import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchMessagePrivacySettings,
} from "@/src/lib/messagePrivacySettingsApi";
import { cacheMessageMediaDefaults } from "@/src/lib/messageMediaDefaults";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  authenticateForMessages,
  cacheRequireDeviceAuthForUser,
  clearMessagesUnlock,
  clearMessagesUnlockForUser,
  isMessagesUnlockStillValid,
  readCachedRequireDeviceAuth,
} from "@/src/lib/messageSecurityLock";
import type { MessagePrivacySettingsV1 } from "@/src/lib/messagePrivacySettingsTypes";
import {
  MS_BG,
  MS_BORDER,
  MS_CARD,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

function currentUserId(): string {
  const headers = getKristoHeaders() as Record<string, string>;
  return String(
    headers?.["x-kristo-user-id"] || headers?.["X-Kristo-User-Id"] || ""
  ).trim();
}

export function MessagesSecurityGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<MessagePrivacySettingsV1 | null>(
    null
  );
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [appSwitcherCover, setAppSwitcherCover] = useState(false);
  const [lockForced, setLockForced] = useState(false);
  const [noBiometricsHint, setNoBiometricsHint] = useState(false);
  const activeUserIdRef = useRef(currentUserId());

  const bootstrap = useCallback(async () => {
    const userId = currentUserId();
    const previousUserId = activeUserIdRef.current;
    if (previousUserId && userId && previousUserId !== userId) {
      await clearMessagesUnlockForUser(previousUserId);
      setUnlocked(false);
    }
    activeUserIdRef.current = userId;

    setBusy(true);
    setError("");
    setNoBiometricsHint(false);
    try {
      const next = await fetchMessagePrivacySettings();
      setSettings(next);
      setLockForced(false);
      void cacheMessageMediaDefaults(next);
      void cacheRequireDeviceAuthForUser(
        userId,
        next.requireDeviceAuthForMessages === true
      );

      if (!next.requireDeviceAuthForMessages) {
        setUnlocked(true);
        return;
      }

      const stillValid = await isMessagesUnlockStillValid(
        next.messageLockTimeout,
        userId
      );
      setUnlocked(stillValid);
    } catch (e: any) {
      // Fail closed when this account previously enabled device auth.
      const cachedRequired = await readCachedRequireDeviceAuth(userId);
      if (cachedRequired === true) {
        setSettings(null);
        setLockForced(true);
        setUnlocked(false);
        setError(
          String(
            e?.message ||
              "Could not verify message security settings. Unlock is required."
          )
        );
        return;
      }
      setSettings(null);
      setLockForced(false);
      setUnlocked(true);
      setError("");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setAppSwitcherCover(false);
      } else {
        const hide = settings?.hideContentInAppSwitcher === true;
        setAppSwitcherCover(hide);
      }

      if (state !== "active") return;
      if (!settings?.requireDeviceAuthForMessages) return;

      void (async () => {
        const userId = currentUserId();
        if (settings.messageLockTimeout === "immediate") {
          await clearMessagesUnlock(userId);
          setUnlocked(false);
          return;
        }
        const stillValid = await isMessagesUnlockStillValid(
          settings.messageLockTimeout,
          userId
        );
        if (!stillValid) setUnlocked(false);
      })();
    });
    return () => sub.remove();
  }, [settings]);

  const onUnlock = useCallback(async () => {
    setBusy(true);
    setError("");
    setNoBiometricsHint(false);
    const userId = currentUserId();
    const result = await authenticateForMessages(userId);
    if (result.ok) {
      setUnlocked(true);
      setLockForced(false);
    } else {
      setNoBiometricsHint(result.noBiometrics === true);
      setError(result.error || "Could not unlock Messages.");
    }
    setBusy(false);
  }, []);

  const requiresLock =
    settings?.requireDeviceAuthForMessages === true || lockForced === true;

  if (busy && !settings && !lockForced) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={MS_GOLD} />
      </View>
    );
  }

  if (requiresLock && !unlocked) {
    return (
      <View style={s.center}>
        <View style={s.lockCard}>
          <View style={s.lockIcon}>
            <Ionicons name="lock-closed" size={28} color={MS_GOLD} />
          </View>
          <Text style={s.lockTitle}>Messages locked</Text>
          <Text style={s.lockSub}>
            Authenticate with Face ID, Touch ID, or your device passcode to
            continue. This is device security only — not end-to-end encryption.
          </Text>
          {error ? <Text style={s.lockError}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Unlock Messages"
            onPress={() => void onUnlock()}
            disabled={busy}
            style={({ pressed }) => [
              s.unlockBtn,
              pressed ? s.unlockBtnPressed : null,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#0A1220" />
            ) : (
              <Text style={s.unlockText}>Unlock</Text>
            )}
          </Pressable>
          {noBiometricsHint ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open device settings"
              onPress={() => void Linking.openSettings()}
              style={s.settingsLink}
            >
              <Text style={s.settingsLinkText}>Open device Settings</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={s.fill}>
      {children}
      {appSwitcherCover ? (
        <View style={s.cover} pointerEvents="none">
          <Ionicons name="chatbubbles-outline" size={36} color={MS_GOLD} />
          <Text style={s.coverText}>Messages</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex: 1,
    backgroundColor: MS_BG,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  lockCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 18,
    backgroundColor: MS_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MS_BORDER,
    padding: 22,
    alignItems: "center",
    gap: 10,
  },
  lockIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    marginBottom: 4,
  },
  lockTitle: {
    color: MS_TEXT,
    fontSize: 20,
    fontWeight: "750" as any,
  },
  lockSub: {
    color: MS_SUB,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  lockError: {
    color: "#FF8A8A",
    fontSize: 12,
    textAlign: "center",
  },
  unlockBtn: {
    marginTop: 8,
    minHeight: 48,
    minWidth: 160,
    borderRadius: 14,
    backgroundColor: MS_GOLD,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  unlockBtnPressed: {
    opacity: 0.9,
  },
  unlockText: {
    color: "#0A1220",
    fontSize: 15,
    fontWeight: "800",
  },
  settingsLink: {
    marginTop: 4,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  settingsLinkText: {
    color: MS_GOLD,
    fontSize: 13,
    fontWeight: "700",
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: MS_BG,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    zIndex: 999,
  },
  coverText: {
    color: MS_TEXT,
    fontSize: 18,
    fontWeight: "700",
  },
});
