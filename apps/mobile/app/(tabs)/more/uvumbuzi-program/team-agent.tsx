import React from "react";
import { Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  MetaRow,
  ProgramCard,
  ProgramScreen,
  programStyles,
  StatusPill,
} from "@/src/components/uvumbuziProgramUi";
import {
  fetchSupervisorAgent,
  type ProgramAgent,
  type ProgramChurch,
} from "@/src/lib/offlineActivationProgramApi";
import { FOLLOW_UP_LABEL } from "@/src/lib/offlineActivationProgramLabels";

export default function UvumbuziTeamAgentScreen() {
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const [agent, setAgent] = React.useState<ProgramAgent | null>(null);
  const [churches, setChurches] = React.useState<ProgramChurch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    fetchSupervisorAgent(String(userId || ""))
      .then((result) => {
        if (!alive) return;
        setAgent(result.agent);
        setChurches(result.churches);
      })
      .catch((e) => alive && setError(String(e?.message || "Imeshindikana")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <ProgramScreen title={agent?.name || "Agent"} subtitle="Makanisa aliyosaidia" icon="person-outline" loading={loading} error={error}>
      {agent ? (
        <ProgramCard>
          <MetaRow label="Kristo ID" value={agent.kristoId} />
          <MetaRow label="Hali" value={agent.accessStatus} />
          <MetaRow label="Alijiunga" value={new Date(agent.joinedAt).toLocaleDateString()} />
        </ProgramCard>
      ) : null}
      {churches.map((church) => (
        <ProgramCard key={church.id} title={church.churchId || "Kanisa (bado halijasajiliwa)"}>
          <StatusPill status={church.status} />
          <MetaRow label="Kiongozi" value={church.leaderKristoId} />
          {church.agentReport ? (
            <>
              <Text style={programStyles.helper}>Ripoti ya agent: {church.agentReport.trainingTopics.join(", ")}</Text>
              <MetaRow label="Ufuatiliaji" value={FOLLOW_UP_LABEL[church.agentReport.followUpStatus]} />
            </>
          ) : null}
          {church.leaderConfirmation?.respondedAt ? (
            <Text style={programStyles.helper}>
              Jibu la kiongozi ({new Date(church.leaderConfirmation.respondedAt).toLocaleDateString()})
              {church.leaderConfirmation.note ? `: “${church.leaderConfirmation.note}”` : ""}
            </Text>
          ) : null}
        </ProgramCard>
      ))}
      {!loading && !error && churches.length === 0 ? (
        <ProgramCard>
          <Text style={programStyles.helper}>Bado hajasaidia kanisa.</Text>
        </ProgramCard>
      ) : null}
    </ProgramScreen>
  );
}
