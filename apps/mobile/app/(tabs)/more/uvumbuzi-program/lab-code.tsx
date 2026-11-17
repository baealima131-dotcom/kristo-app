import React from "react";
import { Alert, Text } from "react-native";
import { GoldPrimaryButton } from "@/src/components/offlineActivationAdminDashboardUi";
import {
  ProgramCard,
  ProgramScreen,
  programStyles,
} from "@/src/components/uvumbuziProgramUi";
import { createLabAdminSignInCode } from "@/src/lib/offlineActivationProgramApi";

/** System Admin: one-time, 2-minute code to sign in to the UVUMBUZI Lab admin page. */
export default function UvumbuziLabCodeScreen() {
  const [code, setCode] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  const [busy, setBusy] = React.useState(false);
  const [labAdminUrl, setLabAdminUrl] = React.useState("");

  React.useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));
  const expired = Boolean(code) && secondsLeft === 0;

  const onCreate = async () => {
    setBusy(true);
    try {
      const result = await createLabAdminSignInCode();
      setCode(result.code);
      setLabAdminUrl(result.labAdminUrl || "");
      setExpiresAt(Date.parse(result.expiresAt));
      setNow(Date.now());
    } catch (e: any) {
      Alert.alert("Imeshindikana", String(e?.message || ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProgramScreen title="Uvumbuzi Lab" subtitle="System Admin · code ya kuingia" icon="flask-outline" loading={false}>
      <ProgramCard>
        <Text style={programStyles.helper}>
          Fungua ukurasa wa System Admin wa Uvumbuzi Lab kwenye kompyuta, kisha ingiza code hii. Inatumika mara moja tu na inaisha baada ya dakika 2.
        </Text>
        {labAdminUrl ? <Text selectable style={programStyles.strong}>{labAdminUrl}</Text> : null}
        {code && !expired ? (
          <>
            <Text selectable style={programStyles.code}>{code}</Text>
            <Text style={[programStyles.helper, { textAlign: "center" }]}>Inaisha baada ya sekunde {secondsLeft}</Text>
          </>
        ) : null}
        {expired ? <Text style={programStyles.helper}>Code imeisha muda. Tengeneza nyingine.</Text> : null}
        <GoldPrimaryButton label={code ? "Tengeneza code mpya" : "Tengeneza code"} onPress={() => void onCreate()} loading={busy} />
      </ProgramCard>
    </ProgramScreen>
  );
}
