import React from "react";
import { Alert, Text } from "react-native";
import { useRouter } from "expo-router";
import { GoldPrimaryButton } from "@/src/components/offlineActivationAdminDashboardUi";
import {
  ProgramCard,
  ProgramField,
  ProgramScreen,
  programStyles,
} from "@/src/components/uvumbuziProgramUi";
import { redeemAgentCode } from "@/src/lib/offlineActivationProgramApi";

/** Enter a supervisor's invite code. The server checks expiry, uses, limit and team. */
export default function UvumbuziJoinScreen() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const onJoin = async () => {
    setBusy(true);
    try {
      await redeemAgentCode(code.trim());
      Alert.alert("Karibu", "Sasa wewe ni agent. Kadi ya Agent itaonekana kwenye More.", [
        { text: "Fungua", onPress: () => router.replace("/more/uvumbuzi-program/agent" as any) },
      ]);
    } catch (e: any) {
      Alert.alert("Code haikukubaliwa", String(e?.message || ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProgramScreen title="Ingiza code ya mwaliko" subtitle="Uvumbuzi · Agent" icon="key-outline" loading={false}>
      <ProgramCard>
        <Text style={programStyles.helper}>
          Ingiza code uliyopewa na supervisor wako. Code ina muda wa kuisha na idadi ndogo ya matumizi.
        </Text>
        <ProgramField label="Code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="AG-XXXX-XXXX" maxLength={20} />
        <GoldPrimaryButton label="Jiunge" onPress={() => void onJoin()} loading={busy} disabled={code.trim().length < 8} />
      </ProgramCard>
    </ProgramScreen>
  );
}
