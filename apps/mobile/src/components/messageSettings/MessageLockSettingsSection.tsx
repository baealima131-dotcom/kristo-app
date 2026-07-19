import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  changeMessageLockPin,
  disableMessageLock,
  fetchMessageLockStatus,
  patchMessageLockTimeout,
  setupMessageLock,
  verifyMessageLockPin,
} from "@/src/lib/messageLockApi";
import {
  cacheMessageLockStatus,
  clearMessageLockLocalState,
  markMessageLockUnlocked,
} from "@/src/lib/messageLockSession";
import {
  DEFAULT_MESSAGE_LOCK_STATUS,
  isWeakMessageLockPin,
  labelForMessageLockTimeout,
  MESSAGE_LOCK_PIN_LENGTHS,
  TIMEOUT_OPTIONS,
  type MessageLockPinLength,
  type MessageLockStatus,
  type MessageLockTimeoutSeconds,
} from "@/src/lib/messageLockTypes";
import { getSessionSync } from "@/src/lib/kristoSessionSync";
import { KristoPinKeypad } from "./KristoPinKeypad";
import { SettingsChoiceRow } from "./SettingsChoiceRow";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { SettingsToggleRow } from "./SettingsToggleRow";
import {
  MS_BORDER,
  MS_CARD,
  MS_DANGER,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

type Flow =
  | null
  | { kind: "setup-length" }
  | { kind: "setup-enter"; pinLength: MessageLockPinLength }
  | { kind: "setup-confirm"; pinLength: MessageLockPinLength; pin: string }
  | { kind: "change-current" }
  | {
      kind: "change-length";
      currentPin: string;
    }
  | {
      kind: "change-enter";
      currentPin: string;
      pinLength: MessageLockPinLength;
    }
  | {
      kind: "change-confirm";
      currentPin: string;
      pinLength: MessageLockPinLength;
      pin: string;
    }
  | { kind: "disable-current" }
  | { kind: "timeout-current"; timeoutSeconds: MessageLockTimeoutSeconds }
  | { kind: "timeout-pick" };

type Props = {
  /** True when the Messages gate has already unlocked this session. */
  gateUnlocked: boolean;
};

export function MessageLockSettingsSection({ gateUnlocked }: Props) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<MessageLockStatus>(
    DEFAULT_MESSAGE_LOCK_STATUS
  );
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<Flow>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const userId = String(getSessionSync()?.userId || "").trim();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchMessageLockStatus();
      setStatus(next);
      if (userId) await cacheMessageLockStatus(userId, next);
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function closeFlow() {
    setFlow(null);
    setPin("");
    setError("");
    setBusy(false);
  }

  async function afterCredentialChange(next: MessageLockStatus) {
    setStatus(next);
    if (userId) {
      await cacheMessageLockStatus(userId, next);
      await clearMessageLockLocalState(userId);
      if (next.enabled && next.hasPin) {
        await markMessageLockUnlocked({
          userId,
          timeoutSeconds: next.timeoutSeconds,
        });
      }
    }
  }

  // Auto-submit when PIN length reached in modal flows
  useEffect(() => {
    if (!flow || busy || cooldown > 0) return;

    const run = async () => {
      try {
        if (flow.kind === "setup-enter" && pin.length === flow.pinLength) {
          if (isWeakMessageLockPin(pin)) {
            setError(
              "Choose a stronger PIN. Avoid repeated digits or simple sequences."
            );
            setPin("");
            return;
          }
          setFlow({ kind: "setup-confirm", pinLength: flow.pinLength, pin });
          setPin("");
          setError("");
          return;
        }

        if (flow.kind === "setup-confirm" && pin.length === flow.pinLength) {
          if (pin !== flow.pin) {
            setError("PIN confirmation does not match. Enter confirmation again.");
            setPin("");
            return;
          }
          setBusy(true);
          const next = await setupMessageLock({
            pin: flow.pin,
            confirmPin: pin,
            pinLength: flow.pinLength,
            timeoutSeconds: status.timeoutSeconds || 0,
          });
          await afterCredentialChange(next);
          closeFlow();
          return;
        }

        if (flow.kind === "change-current" && status.pinLength && pin.length === status.pinLength) {
          setBusy(true);
          const currentPin = pin;
          await verifyMessageLockPin(currentPin);
          setFlow({ kind: "change-length", currentPin });
          setPin("");
          setError("");
          setBusy(false);
          return;
        }

        if (flow.kind === "change-enter" && pin.length === flow.pinLength) {
          if (isWeakMessageLockPin(pin)) {
            setError(
              "Choose a stronger PIN. Avoid repeated digits or simple sequences."
            );
            setPin("");
            return;
          }
          setFlow({
            kind: "change-confirm",
            currentPin: flow.currentPin,
            pinLength: flow.pinLength,
            pin,
          });
          setPin("");
          setError("");
          return;
        }

        if (flow.kind === "change-confirm" && pin.length === flow.pinLength) {
          if (pin !== flow.pin) {
            setError("PIN confirmation does not match. Enter confirmation again.");
            setPin("");
            return;
          }
          setBusy(true);
          const next = await changeMessageLockPin({
            currentPin: flow.currentPin,
            pin: flow.pin,
            confirmPin: pin,
            pinLength: flow.pinLength,
          });
          await afterCredentialChange(next);
          closeFlow();
          return;
        }

        if (flow.kind === "disable-current" && status.pinLength && pin.length === status.pinLength) {
          setBusy(true);
          const next = await disableMessageLock(pin);
          await afterCredentialChange(next);
          closeFlow();
          return;
        }

        if (
          flow.kind === "timeout-current" &&
          status.pinLength &&
          pin.length === status.pinLength
        ) {
          setBusy(true);
          const next = await patchMessageLockTimeout({
            currentPin: pin,
            timeoutSeconds: flow.timeoutSeconds,
          });
          setStatus(next);
          if (userId) await cacheMessageLockStatus(userId, next);
          closeFlow();
        }
      } catch (e: any) {
        setPin("");
        setBusy(false);
        const sec = Math.max(0, Number(e?.cooldownRemainingSec || 0));
        setCooldown(sec);
        setError(String(e?.message || "Something went wrong."));
      } finally {
        setBusy(false);
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, flow, busy, cooldown]);

  // Management controls only when gate unlocked (layout already enforces this when lock on).
  const showManagement = gateUnlocked && status.enabled && status.hasPin;

  return (
    <>
      <SettingsSectionCard
        title="Kristo Message Lock"
        subtitle="Protect your Messages with a PIN created inside Kristo App."
      >
        {loading ? (
          <ActivityIndicator color={MS_GOLD} style={{ marginVertical: 12 }} />
        ) : (
          <>
            <SettingsToggleRow
              label="Enable Message Lock"
              description={
                status.enabled
                  ? "Messages require your Kristo PIN."
                  : "Create a 4, 6, or 8 digit Kristo PIN to enable."
              }
              value={status.enabled}
              onValueChange={(v) => {
                if (v) {
                  setFlow({ kind: "setup-length" });
                  setError("");
                  setPin("");
                } else if (showManagement) {
                  setFlow({ kind: "disable-current" });
                  setError("");
                  setPin("");
                }
              }}
              disabled={status.enabled && !showManagement}
            />

            {showManagement ? (
              <>
                <SettingsChoiceRow
                  label="PIN length"
                  valueLabel={`${status.pinLength || 4} digits`}
                  onPress={() => {
                    setFlow({ kind: "change-current" });
                    setPin("");
                    setError("");
                  }}
                  accessibilityLabel="Change PIN length"
                />
                <SettingsChoiceRow
                  label="Change PIN"
                  valueLabel="Update"
                  onPress={() => {
                    setFlow({ kind: "change-current" });
                    setPin("");
                    setError("");
                  }}
                />
                <SettingsChoiceRow
                  label="Lock timeout"
                  valueLabel={labelForMessageLockTimeout(status.timeoutSeconds)}
                  onPress={() => {
                    setFlow({ kind: "timeout-pick" });
                    setError("");
                  }}
                />
                <Pressable
                  onPress={() => {
                    setFlow({ kind: "disable-current" });
                    setPin("");
                    setError("");
                  }}
                  style={s.disableBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Disable Message Lock"
                >
                  <Text style={s.disableText}>Disable Message Lock</Text>
                </Pressable>
              </>
            ) : null}

            <Text style={s.recoveryNote}>
              Forgot your PIN? Reset is not available in this version. A future
              secure Kristo account re-verification flow will be required — there
              is no silent reset from an unlocked session.
            </Text>
            <Text style={s.privacyNote}>
              Kristo Message Lock is app privacy protection, not end-to-end
              encryption.
            </Text>
          </>
        )}
      </SettingsSectionCard>

      <Modal visible={!!flow} animationType="slide" presentationStyle="fullScreen">
        <View
          style={[
            s.modal,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
          ]}
        >
          <Pressable onPress={closeFlow} style={s.close} accessibilityRole="button">
            <Text style={s.closeText}>Cancel</Text>
          </Pressable>

          {flow?.kind === "setup-length" || flow?.kind === "change-length" ? (
            <View style={s.pickWrap}>
              <Text style={s.pickTitle}>
                {flow.kind === "setup-length" ? "Choose PIN length" : "New PIN length"}
              </Text>
              {MESSAGE_LOCK_PIN_LENGTHS.map((len) => (
                <Pressable
                  key={len}
                  style={s.pickRow}
                  onPress={() => {
                    if (flow.kind === "setup-length") {
                      setFlow({ kind: "setup-enter", pinLength: len });
                    } else {
                      setFlow({
                        kind: "change-enter",
                        currentPin: flow.currentPin,
                        pinLength: len,
                      });
                    }
                    setPin("");
                    setError("");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${len} digit PIN`}
                >
                  <Text style={s.pickText}>{len} digits</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {flow?.kind === "timeout-pick" ? (
            <View style={s.pickWrap}>
              <Text style={s.pickTitle}>Lock timeout</Text>
              {TIMEOUT_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={s.pickRow}
                  onPress={() => {
                    setFlow({
                      kind: "timeout-current",
                      timeoutSeconds: opt.value,
                    });
                    setPin("");
                    setError("");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                >
                  <Text style={s.pickText}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {flow &&
          (flow.kind === "setup-enter" ||
            flow.kind === "setup-confirm" ||
            flow.kind === "change-current" ||
            flow.kind === "change-enter" ||
            flow.kind === "change-confirm" ||
            flow.kind === "disable-current" ||
            flow.kind === "timeout-current") ? (
            <KristoPinKeypad
              length={
                flow.kind === "setup-enter" ||
                flow.kind === "setup-confirm" ||
                flow.kind === "change-enter" ||
                flow.kind === "change-confirm"
                  ? flow.pinLength
                  : status.pinLength || 4
              }
              value={pin}
              onChange={setPin}
              title={
                flow.kind === "setup-enter"
                  ? "Create your Kristo PIN"
                  : flow.kind === "setup-confirm"
                    ? "Confirm your Kristo PIN"
                    : flow.kind === "change-current" ||
                        flow.kind === "disable-current" ||
                        flow.kind === "timeout-current"
                      ? "Enter current PIN"
                      : flow.kind === "change-enter"
                        ? "Enter new PIN"
                        : "Confirm new PIN"
              }
              subtitle="Digits only. Never share your Kristo PIN."
              error={error}
              cooldownRemainingSec={cooldown}
              busy={busy}
            />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  disableBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: MS_BORDER,
  },
  disableText: {
    color: MS_DANGER,
    fontSize: 15,
    fontWeight: "600",
  },
  recoveryNote: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
  privacyNote: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    marginBottom: 4,
  },
  modal: {
    flex: 1,
    backgroundColor: "#07090F",
  },
  close: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  closeText: {
    color: MS_GOLD,
    fontSize: 16,
    fontWeight: "600",
  },
  pickWrap: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  pickTitle: {
    color: MS_TEXT,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },
  pickRow: {
    backgroundColor: MS_CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: MS_BORDER,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  pickText: {
    color: MS_TEXT,
    fontSize: 16,
    fontWeight: "600",
  },
});
