import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function ChurchMemberProfile() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const userId = typeof params.userId === "string" ? params.userId : "";
  const churchId = typeof params.churchId === "string" ? params.churchId : "";
  const churchName = typeof params.churchName === "string" ? params.churchName : "Church";

  const name = typeof params.name === "string" ? params.name : "Member";
  const role = typeof params.role === "string" ? params.role : "Member";
  const status = typeof params.status === "string" ? params.status : "Active";
  const note = typeof params.note === "string" ? params.note : "";

  return (
    <View style={s.wrap}>
      <View style={s.top}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>{name}</Text>
          <Text style={s.sub}>{churchName} • profile</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <View style={s.card}>
          <Text style={s.h}>Details</Text>
          <Text style={s.kv}><Text style={s.k}>UserId:</Text> {userId}</Text>
          <Text style={s.kv}><Text style={s.k}>ChurchId:</Text> {churchId}</Text>
          <Text style={s.kv}><Text style={s.k}>Role:</Text> {role}</Text>
          <Text style={s.kv}><Text style={s.k}>Status:</Text> {status}</Text>
          {!!note && <Text style={s.note}>{note}</Text>}
        </View>

        <View style={s.card}>
          <Text style={s.h}>Actions</Text>
          <Text style={s.muted}>V1: this is a placeholder profile screen. Later we’ll wire real user profile + follow/chat.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#05070B" },
  top: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  },
  backTxt: { color: "rgba(255,255,255,0.9)", fontSize: 22, marginTop: -2 },
  title: { color: "rgba(255,255,255,0.92)", fontSize: 20, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.55)", marginTop: 2 },
  body: { padding: 16, paddingBottom: 28, gap: 12 },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  },
  h: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "800", marginBottom: 10 },
  kv: { color: "rgba(255,255,255,0.78)", marginBottom: 6 },
  k: { color: "rgba(255,255,255,0.55)" },
  note: { color: "rgba(255,255,255,0.65)", marginTop: 6 },
  muted: { color: "rgba(255,255,255,0.55)", lineHeight: 18 }
});
