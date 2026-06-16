import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";

export default function AuditTrailScreen() {
  const router = useRouter();

  const data = [
    {
      id: "1",
      title: "Role Approved",
      desc: "role-1 approved by admin",
      time: "3/21/2026, 12:48 PM",
      type: "success" as const,
    },
    {
      id: "2",
      title: "Approval Request",
      desc: "req-1 approved",
      time: "3/21/2026, 12:47 PM",
      type: "info" as const,
    },
  ];

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.headerWrap}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>Audit Trail</Text>
          <Text style={s.subtitle}>High-level security activity timeline.</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {data.map((item) => (
          <View key={item.id} style={s.card}>
            <View style={s.row}>
              <View
                style={[
                  s.icon,
                  item.type === "success" ? s.iconSuccess : null,
                  item.type === "info" ? s.iconInfo : null,
                ]}
              >
                <Ionicons
                  name={item.type === "success" ? "checkmark-done" : "shield-outline"}
                  size={18}
                  color="#fff"
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{item.title}</Text>
                <Text style={s.desc}>{item.desc}</Text>
                <Text style={s.time}>{item.time}</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 42,
  },

  headerWrap: {
    paddingHorizontal: 18,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  backBtn: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "white",
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 4,
  },

  subtitle: {
    color: SOFT,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 56,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginBottom: 16,
  },

  row: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
  },

  icon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  iconSuccess: {
    backgroundColor: "#1F3D2B",
  },

  iconInfo: {
    backgroundColor: "#2A3A5F",
  },

  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
  },

  desc: {
    color: SOFT,
    fontSize: 14,
    marginTop: 4,
    fontWeight: "700",
  },

  time: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 13,
    marginTop: 6,
    fontWeight: "600",
  },
});
