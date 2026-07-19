import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MS_GOLD, MS_SUB, MS_TEXT } from "./messageSettingsTheme";

type Props = {
  length: number;
  value: string;
  onChange: (next: string) => void;
  title: string;
  subtitle?: string;
  error?: string;
  cooldownRemainingSec?: number;
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabelPrefix?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export function KristoPinKeypad({
  length,
  value,
  onChange,
  title,
  subtitle,
  error,
  cooldownRemainingSec = 0,
  busy = false,
  disabled = false,
  accessibilityLabelPrefix = "Message Lock PIN",
}: Props) {
  const lockedOut = cooldownRemainingSec > 0 || disabled || busy;
  const dots = useMemo(
    () => Array.from({ length }, (_, i) => i < value.length),
    [length, value.length]
  );

  function pressKey(key: (typeof KEYS)[number]) {
    if (lockedOut) return;
    if (key === "clear") {
      onChange("");
      return;
    }
    if (key === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= length) return;
    onChange(value + key);
  }

  return (
    <View style={s.root} accessibilityLabel={accessibilityLabelPrefix}>
      <Text style={s.brand}>Kristo</Text>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}

      <View
        style={s.dotsRow}
        accessibilityLabel={`${accessibilityLabelPrefix} entered ${value.length} of ${length} digits`}
      >
        {dots.map((filled, i) => (
          <View
            key={i}
            style={[s.dot, filled ? s.dotFilled : null]}
            accessibilityElementsHidden
          />
        ))}
      </View>

      {error ? (
        <Text style={s.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {cooldownRemainingSec > 0 ? (
        <Text style={s.cooldown} accessibilityLiveRegion="polite">
          Try again in {cooldownRemainingSec}s
        </Text>
      ) : null}

      {busy && cooldownRemainingSec <= 0 ? (
        <ActivityIndicator color={MS_GOLD} style={{ marginVertical: 12 }} />
      ) : null}

      <View style={s.pad}>
        {KEYS.map((key) => {
          const label =
            key === "back" ? "⌫" : key === "clear" ? "Clear" : key;
          const a11y =
            key === "back"
              ? `${accessibilityLabelPrefix} backspace`
              : key === "clear"
                ? `${accessibilityLabelPrefix} clear`
                : `${accessibilityLabelPrefix} digit ${key}`;
          return (
            <Pressable
              key={key}
              onPress={() => pressKey(key)}
              disabled={lockedOut}
              style={({ pressed }) => [
                s.key,
                key === "clear" ? s.keyWideLabel : null,
                pressed && !lockedOut ? s.keyPressed : null,
                lockedOut ? s.keyDisabled : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={a11y}
            >
              <Text style={s.keyText}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#07090F",
    paddingHorizontal: 24,
    paddingTop: 28,
    justifyContent: "center",
  },
  brand: {
    color: MS_GOLD,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1.2,
    textAlign: "center",
    marginBottom: 8,
  },
  title: {
    color: MS_TEXT,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: MS_SUB,
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    marginTop: 28,
    marginBottom: 16,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "rgba(212,175,55,0.45)",
    backgroundColor: "transparent",
  },
  dotFilled: {
    backgroundColor: MS_GOLD,
    borderColor: MS_GOLD,
  },
  error: {
    color: "#F07178",
    textAlign: "center",
    fontSize: 14,
    marginBottom: 6,
  },
  cooldown: {
    color: MS_GOLD,
    textAlign: "center",
    fontSize: 14,
    marginBottom: 8,
  },
  pad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 12,
    maxWidth: 320,
    alignSelf: "center",
  },
  key: {
    width: 84,
    height: 64,
    margin: 6,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  keyWideLabel: {},
  keyPressed: {
    backgroundColor: "rgba(212,175,55,0.18)",
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyText: {
    color: MS_TEXT,
    fontSize: 22,
    fontWeight: "600",
  },
});
