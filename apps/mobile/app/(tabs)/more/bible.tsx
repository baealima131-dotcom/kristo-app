import { View, Text } from "react-native";

export default function BibleScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#0B0F17", padding: 16 }}>
      <Text style={{ color: "white", fontWeight: "900", fontSize: 22 }}>Bible</Text>
      <Text style={{ color: "rgba(255,255,255,0.70)", marginTop: 10, fontWeight: "700" }}>
        Daily verses & reading (coming soon).
      </Text>
    </View>
  );
}
