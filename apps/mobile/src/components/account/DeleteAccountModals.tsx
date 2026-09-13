import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type PastorOwnedChurchSummary = {
  churchId: string;
  churchName: string | null;
};

type PastorOwnsChurchProps = {
  visible: boolean;
  churches: PastorOwnedChurchSummary[];
  sessionChurchId?: string | null;
  sessionChurchName?: string | null;
  sessionChurchAvatarUrl?: string | null;
  disabled?: boolean;
  onGoToChurch: () => void;
  onNotNow: () => void;
};

export function DeleteAccountPastorOwnsChurchModal({
  visible,
  churches,
  sessionChurchId,
  sessionChurchName,
  disabled = false,
  onGoToChurch,
  onNotNow,
}: PastorOwnsChurchProps) {
  const names = churches
    .map((church) => String(church?.churchName || "").trim())
    .filter(Boolean);

  const fallbackName = String(sessionChurchName || "").trim();
  const visibleNames =
    names.length > 0
      ? names
      : fallbackName
      ? [fallbackName]
      : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!disabled) onNotNow();
      }}
    >
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Ionicons name="business-outline" size={24} color="#F4D06F" />
          </View>

          <Text style={s.title}>Church ownership needs attention</Text>

          <Text style={s.body}>
            You are currently the Pastor or owner of a church. Before deleting
            your Kristo App account, transfer or resolve church ownership first.
          </Text>

          {visibleNames.length > 0 ? (
            <ScrollView
              style={s.churchList}
              contentContainerStyle={s.churchListContent}
              showsVerticalScrollIndicator={false}
            >
              {visibleNames.map((name, index) => (
                <View key={`${name}-${index}`} style={s.churchRow}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={18}
                    color="#F4D06F"
                  />
                  <Text style={s.churchName}>{name}</Text>
                </View>
              ))}
            </ScrollView>
          ) : sessionChurchId ? (
            <Text style={s.churchIdText}>Church ID: {sessionChurchId}</Text>
          ) : null}

          <Pressable
            disabled={disabled}
            onPress={onGoToChurch}
            style={({ pressed }) => [
              s.primaryBtn,
              disabled && s.disabled,
              pressed && !disabled ? s.pressed : null,
            ]}
          >
            <Text style={s.primaryBtnText}>Go to Church</Text>
          </Pressable>

          <Pressable
            disabled={disabled}
            onPress={onNotNow}
            style={({ pressed }) => [
              s.secondaryBtn,
              disabled && s.disabled,
              pressed && !disabled ? s.pressed : null,
            ]}
          >
            <Text style={s.secondaryBtnText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type FinalConfirmProps = {
  visible: boolean;
  variant?: "standard" | string;
  deleting?: boolean;
  onConfirm: () => void;
  onNotNow: () => void;
};

export function DeleteAccountFinalConfirmModal({
  visible,
  deleting = false,
  onConfirm,
  onNotNow,
}: FinalConfirmProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!deleting) onNotNow();
      }}
    >
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={[s.iconWrap, s.dangerIcon]}>
            <Ionicons name="warning-outline" size={25} color="#FF7276" />
          </View>

          <Text style={s.title}>Delete your account?</Text>

          <Text style={s.body}>
            This action permanently deletes your Kristo App account and cannot
            be undone.
          </Text>

          <Pressable
            disabled={deleting}
            onPress={onConfirm}
            style={({ pressed }) => [
              s.deleteBtn,
              deleting && s.disabled,
              pressed && !deleting ? s.pressed : null,
            ]}
          >
            {deleting ? (
              <View style={s.loadingRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={s.deleteBtnText}>Deleting...</Text>
              </View>
            ) : (
              <Text style={s.deleteBtnText}>Delete account</Text>
            )}
          </Pressable>

          <Pressable
            disabled={deleting}
            onPress={onNotNow}
            style={({ pressed }) => [
              s.secondaryBtn,
              deleting && s.disabled,
              pressed && !deleting ? s.pressed : null,
            ]}
          >
            <Text style={s.secondaryBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    padding: 22,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: "#090E19",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.22)",
    borderRadius: 24,
    padding: 22,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.10)",
    marginBottom: 16,
  },
  dangerIcon: {
    backgroundColor: "rgba(255,90,95,0.11)",
  },
  title: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    marginBottom: 10,
  },
  body: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
  },
  churchList: {
    maxHeight: 150,
    marginBottom: 18,
  },
  churchListContent: {
    gap: 8,
  },
  churchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  churchName: {
    flex: 1,
    color: "#fff",
    fontWeight: "800",
  },
  churchIdText: {
    color: "rgba(255,255,255,0.60)",
    marginBottom: 18,
  },
  primaryBtn: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#F4D06F",
    marginBottom: 10,
  },
  primaryBtnText: {
    color: "#090E19",
    fontWeight: "900",
    fontSize: 15,
  },
  deleteBtn: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#D9454B",
    marginBottom: 10,
  },
  deleteBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
  },
  secondaryBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  secondaryBtnText: {
    color: "rgba(255,255,255,0.80)",
    fontWeight: "800",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
});
