import { View, Text } from "react-native";

export default function MeScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#0B0F17", padding: 16 }}>
      <Text style={{ color: "white", fontWeight: "900", fontSize: 18 }}>Me</Text>
      <Text style={{ color: "rgba(255,255,255,0.70)", marginTop: 8 }}>
        Profile settings zinakuja hapa.
      </Text>
    </View>
  );
}
