import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MS_BG,
  MS_BORDER,
  MS_CARD,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

export type SettingsChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

export function SettingsChoiceSheet<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<SettingsChoiceOption<T>>;
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.root}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={s.closeBtn}
              hitSlop={10}
            >
              <Ionicons name="close" size={20} color={MS_TEXT} />
            </Pressable>
          </View>
          <ScrollView style={s.list} bounces={false}>
            {options.map((option) => {
              const active = option.value === selected;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                  onPress={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    s.option,
                    active ? s.optionActive : null,
                    pressed ? s.optionPressed : null,
                  ]}
                >
                  <View style={s.optionCopy}>
                    <Text style={s.optionLabel}>{option.label}</Text>
                    {option.description ? (
                      <Text style={s.optionDescription}>{option.description}</Text>
                    ) : null}
                  </View>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={20} color={MS_GOLD} />
                  ) : (
                    <View style={s.radio} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: MS_BG,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MS_BORDER,
    maxHeight: "78%",
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    color: MS_TEXT,
    fontSize: 17,
    fontWeight: "700",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MS_CARD,
  },
  list: {
    paddingHorizontal: 12,
  },
  option: {
    minHeight: 56,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: MS_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  optionActive: {
    borderColor: MS_GOLD,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  optionPressed: {
    opacity: 0.9,
  },
  optionCopy: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    color: MS_TEXT,
    fontSize: 15,
    fontWeight: "650" as any,
  },
  optionDescription: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 16,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.28)",
  },
});
