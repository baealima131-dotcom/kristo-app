import React from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { GoldPrimaryButton } from "@/src/components/offlineActivationAdminDashboardUi";
import { GlassButton } from "@/src/components/systemAdminSupervisorUi";
import {
  MetaRow,
  ProgramCard,
  ProgramField,
  ProgramScreen,
  programStyles,
} from "@/src/components/uvumbuziProgramUi";
import {
  fetchLeaderConfirmations,
  respondLeaderConfirmation,
  type LeaderConfirmationRequest,
} from "@/src/lib/offlineActivationProgramApi";
import { FOLLOW_UP_LABEL } from "@/src/lib/offlineActivationProgramLabels";

/** Church leader inbox: answer "did this agent help and train you?" in the app. */
export default function UvumbuziLeaderConfirmationsScreen() {
  const [requests, setRequests] = React.useState<LeaderConfirmationRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setError("");
      setRequests(await fetchLeaderConfirmations());
    } catch (e: any) {
      setError(String(e?.message || "Imeshindikana"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <ProgramScreen title="Uthibitisho wa mafunzo" subtitle="Kristo · Kiongozi wa kanisa" icon="checkmark-done-outline" loading={loading} error={error}>
      {requests.length === 0 ? (
        <ProgramCard>
          <Text style={programStyles.helper}>Hakuna ombi linalosubiri.</Text>
        </ProgramCard>
      ) : (
        requests.map((request) => <RequestCard key={request.requestId} request={request} onDone={load} />)
      )}
    </ProgramScreen>
  );
}

function RequestCard({ request, onDone }: { request: LeaderConfirmationRequest; onDone: () => Promise<void> }) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const answer = async (response: "confirm" | "reject" | "needs_help") => {
    setBusy(true);
    try {
      await respondLeaderConfirmation(request.requestId, response, note);
      await onDone();
    } catch (e: any) {
      Alert.alert("Haikutumwa", String(e?.message || ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProgramCard>
      <Text style={programStyles.strong}>{request.question}</Text>
      <MetaRow label="Agent" value={`${request.agent.name || "—"} (${request.agent.kristoId || "—"})`} />
      <MetaRow label="Kanisa" value={request.churchId} />
      <Text style={programStyles.helper}>Agent anasema alikufundisha: {request.report.trainingTopics.join(", ")}</Text>
      {request.report.trainingNotes ? <Text style={programStyles.helper}>{request.report.trainingNotes}</Text> : null}
      <MetaRow label="Ufuatiliaji" value={FOLLOW_UP_LABEL[request.report.followUpStatus]} />
      <ProgramField label="Maoni (si lazima)" value={note} onChangeText={setNote} maxLength={500} />
      <GoldPrimaryButton label="Ndiyo, nimeelewa" onPress={() => void answer("confirm")} disabled={busy} />
      <GlassButton label="Nahitaji msaada zaidi" onPress={() => !busy && void answer("needs_help")} />
      <View style={{ alignItems: "center" }}>
        <Pressable
          disabled={busy}
          onPress={() =>
            Alert.alert("Kataa?", "Utaarifu kuwa agent huyu hakukusaidia.", [
              { text: "Hapana", style: "cancel" },
              { text: "Kataa", style: "destructive", onPress: () => void answer("reject") },
            ])
          }
        >
          <Text style={{ color: "#FF8A80", fontWeight: "700", paddingVertical: 6 }}>Hapana, hakunisaidia</Text>
        </Pressable>
      </View>
    </ProgramCard>
  );
}
