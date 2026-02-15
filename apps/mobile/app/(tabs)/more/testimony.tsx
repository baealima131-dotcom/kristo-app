import { View, Text } from "react-native";

export default function TestimonyScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#0B0F17", padding: 16 }}>
      <Text style={{ color: "white", fontWeight: "900", fontSize: 22 }}>Testimony</Text>
      <Text style={{ color: "rgba(255,255,255,0.70)", marginTop: 10, fontWeight: "700" }}>
        Stories of faith (coming soon).
      </Text>
    </View>
  );
}
