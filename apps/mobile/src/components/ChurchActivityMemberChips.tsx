import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type ChurchActivityMemberChip = {
  userId: string;
  name: string;
  avatarUri?: string;
};

type ChipKey = "all" | "mine" | string;

const AVATAR_SIZE = 56;

export default function ChurchActivityMemberChips({
  members,
  selectedKey,
  onSelect,
}: {
  members: ChurchActivityMemberChip[];
  selectedKey: ChipKey;
  onSelect: (key: ChipKey, memberId?: string) => void;
  currentUserName?: string;
}) {
  const renderChip = (
    key: ChipKey,
    label: string,
    avatarUri?: string,
    memberId?: string
  ) => {
    const active = selectedKey === key;
    const initial = String(label || "?").trim().charAt(0).toUpperCase() || "?";

    return (
      <Pressable
        key={key}
        onPress={() => onSelect(key, memberId)}
        style={s.chip}
      >
        <View style={[s.avatarShell, active ? s.avatarShellActive : null]}>
          {active ? <View pointerEvents="none" style={s.avatarGlow} /> : null}
          <View style={[s.avatarRing, active ? s.avatarRingActive : null]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={s.avatar} resizeMode="cover" />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarInitial}>{initial}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={[s.chipLabel, active ? s.chipLabelActive : null]} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
    >
      {renderChip("all", "All Church")}
      {renderChip("mine", "My Posts")}
      {members.map((member) =>
        renderChip(member.userId, member.name, member.avatarUri, member.userId)
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: {
    paddingVertical: 2,
    paddingRight: 6,
    gap: 8,
    alignItems: "flex-start",
  },
  chip: {
    width: 64,
    alignItems: "center",
    gap: 7,
  },
  avatarShell: {
    width: AVATAR_SIZE + 8,
    height: AVATAR_SIZE + 8,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarShellActive: {},
  avatarGlow: {
    position: "absolute",
    width: AVATAR_SIZE + 10,
    height: AVATAR_SIZE + 10,
    borderRadius: (AVATAR_SIZE + 10) / 2,
    backgroundColor: "rgba(217,179,95,0.14)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  avatarRing: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    padding: 2,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  avatarRingActive: {
    borderColor: "rgba(217,179,95,0.96)",
    borderWidth: 2,
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    flex: 1,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  avatarInitial: {
    color: "#F4D06F",
    fontSize: 15,
    fontWeight: "900",
  },
  chipLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 9.5,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 12,
    maxWidth: 64,
  },
  chipLabelActive: {
    color: "#F4D06F",
  },
});
