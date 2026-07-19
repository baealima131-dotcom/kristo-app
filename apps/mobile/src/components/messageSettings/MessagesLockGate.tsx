import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  type AppStateStatus,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { clearLegacyMessageLockPrefs } from "@/src/lib/clearLegacyMessageLockPrefs";
import {
  fetchMessageLockStatus,
  verifyMessageLockPin,
} from "@/src/lib/messageLockApi";
import {
  cacheMessageLockStatus,
  clearMessageLockUnlock,
  isMessageLockLocallyUnlocked,
  markMessageLockUnlocked,
  onMessageLockAppBackground,
  readCachedMessageLockStatus,
} from "@/src/lib/messageLockSession";
import {
  DEFAULT_MESSAGE_LOCK_STATUS,
  type MessageLockStatus,
} from "@/src/lib/messageLockTypes";
import { KristoPinKeypad } from "./KristoPinKeypad";
import { MS_SUB } from "./messageSettingsTheme";

type Props = {
  children: React.ReactNode;
};

export function MessagesLockGate({ children }: Props) {
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();
  const userId = String(session?.userId || "").trim();
  const prevUserIdRef = useRef<string>("");

  const [status, setStatus] = useState<MessageLockStatus>(
    DEFAULT_MESSAGE_LOCK_STATUS
  );
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refreshGate = useCallback(async () => {
    if (!userId) {
      setChecking(false);
      setUnlocked(true);
      setStatus(DEFAULT_MESSAGE_LOCK_STATUS);
      return;
    }

    setChecking(true);
    setError("");
    try {
      await clearLegacyMessageLockPrefs();
      let next = await fetchMessageLockStatus();
      await cacheMessageLockStatus(userId, next);
      setStatus(next);

      if (!next.enabled || !next.hasPin) {
        setUnlocked(true);
        setChecking(false);
        return;
      }

      const localOk = await isMessageLockLocallyUnlocked(
        userId,
        next.timeoutSeconds
      );
      setUnlocked(localOk);
      setCooldown(next.cooldownRemainingSec || 0);
    } catch {
      const cached = await readCachedMessageLockStatus(userId);
      if (cached?.enabled && cached.hasPin) {
        setStatus(cached);
        const localOk = await isMessageLockLocallyUnlocked(
          userId,
          cached.timeoutSeconds
        );
        // Offline / error after unlock expiry stays locked.
        setUnlocked(localOk);
        if (!localOk) {
          setError("Connect to the internet to unlock Messages.");
        }
      } else {
        // Fail open only when we have no evidence lock is enabled.
        setStatus(DEFAULT_MESSAGE_LOCK_STATUS);
        setUnlocked(true);
      }
    } finally {
      setChecking(false);
    }
  }, [userId]);

  useEffect(() => {
    const prev = prevUserIdRef.current;
    if (prev && prev !== userId) {
      void clearMessageLockUnlock(prev);
    }
    prevUserIdRef.current = userId;
    setPin("");
    setError("");
    void refreshGate();
  }, [userId, refreshGate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (!userId) return;
      if (state !== "active") {
        onMessageLockAppBackground(userId, statusRef.current.timeoutSeconds);
        if (statusRef.current.timeoutSeconds === 0 && statusRef.current.enabled) {
          setUnlocked(false);
          setPin("");
        }
        return;
      }
      void (async () => {
        if (!statusRef.current.enabled || !statusRef.current.hasPin) return;
        const ok = await isMessageLockLocallyUnlocked(
          userId,
          statusRef.current.timeoutSeconds
        );
        if (!ok) {
          setUnlocked(false);
          setPin("");
        }
      })();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    if (!status.enabled || !status.hasPin || !status.pinLength) return;
    if (pin.length !== status.pinLength) return;
    if (busy || cooldown > 0) return;

    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const next = await verifyMessageLockPin(pin);
        if (cancelled) return;
        setStatus(next);
        await cacheMessageLockStatus(userId, next);
        await markMessageLockUnlocked({
          userId,
          timeoutSeconds: next.timeoutSeconds,
        });
        setUnlocked(true);
        setPin("");
        setCooldown(0);
      } catch (e: any) {
        if (cancelled) return;
        setPin("");
        const sec = Math.max(0, Number(e?.cooldownRemainingSec || 0));
        setCooldown(sec);
        if (e?.data) {
          setStatus(e.data);
          void cacheMessageLockStatus(userId, e.data);
        }
        setError(String(e?.message || "Incorrect PIN."));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pin, status.enabled, status.hasPin, status.pinLength, busy, cooldown, userId]);

  if (checking) {
    return (
      <View style={[s.boot, { paddingTop: insets.top + 40 }]}>
        <Text style={s.bootBrand}>Kristo</Text>
        <Text style={s.bootText}>Checking Message Lock…</Text>
      </View>
    );
  }

  if (status.enabled && status.hasPin && !unlocked) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <KristoPinKeypad
          length={status.pinLength || 4}
          value={pin}
          onChange={setPin}
          title="Enter your Kristo PIN"
          subtitle="Protect your Messages with a PIN created inside Kristo App."
          error={error}
          cooldownRemainingSec={cooldown}
          busy={busy}
          accessibilityLabelPrefix="Unlock Messages"
        />
      </View>
    );
  }

  return <>{children}</>;
}

const s = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: "#07090F",
    alignItems: "center",
  },
  bootBrand: {
    color: "#D4AF37",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 12,
  },
  bootText: {
    color: MS_SUB,
    fontSize: 14,
  },
});
