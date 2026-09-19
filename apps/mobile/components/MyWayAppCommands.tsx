import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import type { Href } from "expo-router";

const destinations = [
  {
    title: "Biblia", route: "/more/bible",
    phrases: ["BIBLE1", "biblia", "fungua biblia", "nifungulie biblia", "open bible"],
  },
  {
    title: "Miadi yangu", route: "/more/my-appointments",
    phrases: ["X", "miadi yangu", "onyesha miadi yangu", "fungua miadi yangu", "my appointments"],
  },
  {
    title: "Taarifa zangu", route: "/more/notifications",
    phrases: ["NOTIFY", "taarifa zangu", "fungua taarifa zangu", "onyesha taarifa zangu", "notifications"],
  },
  {
    title: "Ujumbe wa kanisa", route: "/more/my-church-room/messages",
    phrases: ["CHURCH", "ujumbe wa kanisa", "fungua ujumbe wa kanisa", "church messages"],
  },
  {
    title: "Ripoti zangu", route: "/more/my-reports",
    phrases: ["MYRPTS", "ripoti zangu", "onyesha ripoti zangu", "fungua ripoti zangu", "my reports"],
  },
] as const;

function normalize(text: string) {
  return text.trim().toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^tafadhali /, "")
    .replace(/ tafadhali$/, "")
    .trim();
}

export default function MyWayAppCommands({
  onOpen,
}: {
  onOpen: (route: Href) => void;
}) {
  const [draft, setDraft] = useState("");
  const [match, setMatch] = useState<(typeof destinations)[number] | null>(null);
  const [notice, setNotice] = useState("");

  function check() {
    const text = normalize(draft);
    const found = destinations.find(item =>
      item.phrases.some(phrase => normalize(phrase) === text)
    );
    setMatch(found || null);
    setNotice(found
      ? `Nimepata sehemu: ${found.title}. Bonyeza chini kuifungua.`
      : text
        ? "Ombi hili bado sijalitambua. Chagua mfano hapa chini."
        : "Andika ombi au chagua mfano hapa chini.");
  }

  return <View style={s.box}>
    <Text style={s.title}>MY WAY · Kristo App</Text>
    <Text style={s.copy}>
      Fungua sehemu ya app kwa kuandika ombi. Kwa sasa natambua
      maombi haya matano; mazungumzo ya AI na sauti yataongezwa baadaye.
    </Text>
    <TextInput
      value={draft}
      onChangeText={text => {
        setDraft(text); setMatch(null); setNotice("");
      }}
      placeholder="Mfano: Fungua Biblia"
      placeholderTextColor="#9AAEC5"
      accessibilityLabel="Ombi kwa MY WAY"
      maxLength={200}
      returnKeyType="go"
      onSubmitEditing={check}
      style={s.input}
    />
    <Pressable accessibilityRole="button" onPress={check} style={s.button}>
      <Text style={s.buttonText}>Tambua ombi</Text>
    </Pressable>
    {!!notice && <Text accessibilityLiveRegion="polite" style={s.copy}>{notice}</Text>}
    {match && <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(match.route as Href)}
      style={s.button}
    >
      <Text style={s.buttonText}>Fungua {match.title}</Text>
    </Pressable>}
    <Text style={s.copy}>Jaribu ombi:</Text>
    {destinations.map(item => <Pressable
      key={item.route}
      accessibilityRole="button"
      style={s.example}
      onPress={() => {
        setDraft(item.phrases[2]); setMatch(null); setNotice("");
      }}
    >
      <Text style={s.exampleText}>{item.phrases[2]}</Text>
    </Pressable>)}
  </View>;
}

const s = StyleSheet.create({
  box: { padding:18, borderRadius:20, backgroundColor:"#0C2540", gap:12, marginVertical:12 },
  title: { color:"#F1D58D", fontSize:19, fontWeight:"800" },
  copy: { color:"#C3D8EC", fontSize:13, lineHeight:20 },
  input: { color:"#FFFFFF", backgroundColor:"#06192D", borderRadius:12, padding:14, minHeight:50 },
  button: { backgroundColor:"#EAC365", padding:14, borderRadius:12, alignItems:"center", minHeight:48 },
  buttonText: { color:"#38260D", fontWeight:"800", fontSize:14 },
  example: { padding:12, borderRadius:10, borderWidth:1, borderColor:"#34516E", minHeight:44 },
  exampleText: { color:"#E0EFFF", fontSize:14 },
});
