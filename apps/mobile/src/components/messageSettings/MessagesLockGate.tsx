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
import { messageLockVerifyFailureUi } from "@/src/lib/messageLockVerifyUi";
import {
  cacheMessageLockStatus,
  clearMessageLockUnlock,
  isMessageLockLocallyUnlocked,
  markMessageLockUnlocked,
  onMessageLockAppBackground,
  readCachedMessageLockStatus,
  subscribeMessageLockGateRefresh,
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

function debugGate(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.log("KRISTO_MESSAGE_LOCK_GATE", { event, ...payload });
}

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
  /** Guards in-flight verify without putting `busy` in effect deps (that re-cancel race). */
  const verifyingRef = useRef(false);

  const refreshGate = useCallback(async (source: string) => {
    if (!userId) {
      setChecking(false);
      setUnlocked(true);
      setStatus(DEFAULT_MESSAGE_LOCK_STATUS);
      debugGate("decision", {
        source,
        reason: "no_user",
        checking: false,
        enabled: false,
        hasPin: false,
        unlocked: true,
        renderChildren: true,
      });
      return;
    }

    setChecking(true);
    setError("");
    try {
      await clearLegacyMessageLockPrefs();
      const next = await fetchMessageLockStatus();
      await cacheMessageLockStatus(userId, next);
      setStatus(next);

      debugGate("get_status", {
        source,
        enabled: next.enabled,
        hasPin: next.hasPin,
        pinLength: next.pinLength,
        timeoutSeconds: next.timeoutSeconds,
        locked: next.locked,
        cooldownRemainingSec: next.cooldownRemainingSec,
      });

      if (!next.enabled || !next.hasPin) {
        setUnlocked(true);
        setChecking(false);
        debugGate("decision", {
          source,
          reason: "lock_disabled",
          checking: false,
          enabled: next.enabled,
          hasPin: next.hasPin,
          unlocked: true,
          renderChildren: true,
        });
        return;
      }

      const localOk = await isMessageLockLocallyUnlocked(
        userId,
        next.timeoutSeconds
      );
      setUnlocked(localOk);
      setCooldown(next.cooldownRemainingSec || 0);
      debugGate("decision", {
        source,
        reason: localOk ? "local_unlock_valid" : "require_pin",
        checking: false,
        enabled: true,
        hasPin: true,
        locked: next.locked,
        localUnlocked: localOk,
        unlocked: localOk,
        renderChildren: localOk,
      });
    } catch {
      const cached = await readCachedMessageLockStatus(userId);
      if (cached?.enabled && cached.hasPin) {
        setStatus(cached);
        const localOk = await isMessageLockLocallyUnlocked(
          userId,
          cached.timeoutSeconds
        );
        setUnlocked(localOk);
        if (!localOk) {
          setError("Connect to the internet to unlock Messages.");
        }
        debugGate("decision", {
          source,
          reason: localOk ? "cached_local_unlock" : "offline_locked",
          enabled: true,
          hasPin: true,
          unlocked: localOk,
          renderChildren: localOk,
        });
      } else {
        setStatus(DEFAULT_MESSAGE_LOCK_STATUS);
        setUnlocked(true);
        debugGate("decision", {
          source,
          reason: "fetch_failed_no_cached_lock",
          unlocked: true,
          renderChildren: true,
        });
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
    void refreshGate("mount_or_user");
  }, [userId, refreshGate]);

  // Re-evaluate after setup/change/disable while still inside the Messages subtree.
  useEffect(() => {
    return subscribeMessageLockGateRefresh(() => {
      setPin("");
      setError("");
      setUnlocked(false);
      // Block children immediately — stale status may still say enabled:false.
      setChecking(true);
      void refreshGate("credential_changed");
    });
  }, [refreshGate]);

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
          debugGate("decision", {
            source: "app_background",
            reason: "immediate_timeout_relock",
            unlocked: false,
            renderChildren: false,
          });
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
          debugGate("decision", {
            source: "app_active",
            reason: "unlock_expired",
            unlocked: false,
            renderChildren: false,
          });
        }
      })();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    if (!status.enabled || !status.hasPin || !status.pinLength) return;
    if (pin.length !== status.pinLength) return;
    if (cooldown > 0) return;
    if (verifyingRef.current) return;

    const pinToVerify = pin;
    let cancelled = false;
    verifyingRef.current = true;
    setBusy(true);
    setError("");

    void (async () => {
      try {
        const next = await verifyMessageLockPin(pinToVerify);
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
        setError("");
        debugGate("decision", {
          source: "verify_ok",
          reason: "pin_verified",
          unlocked: true,
          renderChildren: true,
        });
      } catch (e: any) {
        if (cancelled) return;
        const ui = messageLockVerifyFailureUi({
          code: e?.code,
          reason: e?.reason,
          message: e?.message,
          cooldownRemainingSec: e?.cooldownRemainingSec,
          data: e?.data,
        });
        setPin(ui.pin);
        setUnlocked(ui.unlocked);
        setError(ui.error);
        setCooldown(ui.cooldown);
        if (ui.status) {
          setStatus(ui.status);
          void cacheMessageLockStatus(userId, ui.status);
        }
        debugGate("decision", {
          source: "verify_fail",
          reason: String(e?.code || "verify_failed"),
          unlocked: false,
          renderChildren: false,
          cooldownRemainingSec: ui.cooldown,
          // Never log PIN digits.
        });
      } finally {
        verifyingRef.current = false;
        // Always clear spinner — never leave keypad stuck if effect cleanup raced.
        setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pin, status.enabled, status.hasPin, status.pinLength, cooldown, userId]);

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
