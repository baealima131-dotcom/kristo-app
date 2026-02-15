import { View, Text } from "react-native";

const BG = "#0B0F17";
const MUTED = "rgba(255,255,255,0.70)";

export default function CourtshipScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: BG, padding: 16, paddingTop: 18 }}>
      <Text style={{ color: "white", fontWeight: "900", fontSize: 18 }}>Courtship</Text>
      <Text style={{ color: MUTED, marginTop: 8 }}>
        TLMC Courtship module itaingia hapa.
      </Text>
    </View>
  );
}
