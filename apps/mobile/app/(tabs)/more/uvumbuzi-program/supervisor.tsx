import React from "react";
import { Alert, Pressable, Share, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { GoldPrimaryButton } from "@/src/components/offlineActivationAdminDashboardUi";
import {
  ChoiceRow,
  LinkRow,
  MetaRow,
  ProgramCard,
  ProgramScreen,
  PROGRAM_MUTED,
  programStyles,
} from "@/src/components/uvumbuziProgramUi";
import {
  createInviteCode,
  fetchSupervisorTeam,
  revokeInviteCode,
  type SupervisorTeam,
} from "@/src/lib/offlineActivationProgramApi";
import {
  INVITE_CODE_STATE_LABEL,
  ONBOARDING_STATUS_LABEL,
} from "@/src/lib/offlineActivationProgramLabels";

const USES = ["1", "3", "5"] as const;
const TTL = { "24": "Saa 24", "72": "Siku 3", "168": "Siku 7" } as const;

export default function UvumbuziSupervisorScreen() {
  const router = useRouter();
  const [team, setTeam] = React.useState<SupervisorTeam | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [uses, setUses] = React.useState<(typeof USES)[number]>("1");
  const [ttl, setTtl] = React.useState<keyof typeof TTL>("72");
  const [creating, setCreating] = React.useState(false);
  const [newCode, setNewCode] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setError("");
      setTeam(await fetchSupervisorTeam());
    } catch (e: any) {
      setError(String(e?.message || "Imeshindikana kupakia timu"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const remaining = team ? Math.max(0, team.agentLimit - team.agentSlotsUsed) : 0;

  const onCreate = async () => {
    setCreating(true);
    try {
      const result = await createInviteCode(Number(uses), Number(ttl));
      setNewCode(result.code);
      await load();
    } catch (e: any) {
      Alert.alert("Code haikutengenezwa", String(e?.message || ""));
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = (codeId: string, preview: string) =>
    Alert.alert("Futa code?", `Code inayoishia ${preview} haitaweza kutumika tena.`, [
      { text: "Hapana", style: "cancel" },
      {
        text: "Futa",
        style: "destructive",
        onPress: async () => {
          try {
            await revokeInviteCode(codeId);
            await load();
          } catch (e: any) {
            Alert.alert("Imeshindikana", String(e?.message || ""));
          }
        },
      },
    ]);

  const s = team?.onboardings.byStatus;

  return (
    <ProgramScreen
      title="Supervisor"
      subtitle="Timu yangu · Uvumbuzi"
      icon="people-outline"
      loading={loading}
      error={error}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      {team ? (
        <>
          <ProgramCard title="Kikomo cha agents">
            <MetaRow label="Agents" value={`${team.agentSlotsUsed} / ${team.agentLimit}`} />
            <Text style={programStyles.helper}>
              Kikomo kinawekwa na System Admin wa Uvumbuzi Lab. Nafasi zilizobaki: {remaining}.
            </Text>
          </ProgramCard>

          <ProgramCard title="Alika agent kwa code">
            <Text style={programStyles.helper}>Matumizi</Text>
            <ChoiceRow options={[...USES]} value={uses} onChange={setUses} labels={{ "1": "1", "3": "3", "5": "5" }} />
            <Text style={programStyles.helper}>Inaisha baada ya</Text>
            <ChoiceRow options={Object.keys(TTL) as (keyof typeof TTL)[]} value={ttl} onChange={setTtl} labels={TTL} />
            <GoldPrimaryButton label="Tengeneza code" onPress={() => void onCreate()} loading={creating} disabled={remaining < 1} />
            {newCode ? (
              <View style={{ gap: 8 }}>
                <Text selectable style={programStyles.code}>{newCode}</Text>
                <Text style={programStyles.helper}>
                  Code hii inaonekana mara moja tu. Mpe agent mwenyewe; ataiingiza kwenye Kristo → More.
                </Text>
                <Pressable onPress={() => void Share.share({ message: newCode })}>
                  <Text style={[programStyles.strong, { textAlign: "center" }]}>Shiriki code</Text>
                </Pressable>
              </View>
            ) : null}
          </ProgramCard>

          {team.inviteCodes.length ? (
            <ProgramCard title="Codes">
              {team.inviteCodes.slice(0, 12).map((code) => (
                <View key={code.id} style={[programStyles.row, { justifyContent: "space-between" }]}>
                  <View>
                    <Text style={programStyles.strong}>…{code.codePreview}</Text>
                    <Text style={programStyles.helper}>
                      {INVITE_CODE_STATE_LABEL[code.state]} · {code.usedCount}/{code.maxUses} ·{" "}
                      {new Date(code.expiresAt).toLocaleDateString()}
                    </Text>
                  </View>
                  {code.state === "active" ? (
                    <Pressable onPress={() => onRevoke(code.id, code.codePreview)} hitSlop={8}>
                      <Text style={{ color: "#FF8A80", fontWeight: "700" }}>Futa</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ProgramCard>
          ) : null}

          <ProgramCard title="Maendeleo ya makanisa">
            <MetaRow label="Makanisa" value={team.onboardings.churches} />
            {s
              ? (Object.keys(s) as (keyof typeof s)[]).map((key) => (
                  <MetaRow key={key} label={ONBOARDING_STATUS_LABEL[key]} value={s[key]} />
                ))
              : null}
          </ProgramCard>

          <ProgramCard title="Agents wangu">
            {team.agents.length === 0 ? (
              <Text style={programStyles.helper}>Bado hakuna agent.</Text>
            ) : (
              team.agents.map((agent) => (
                <LinkRow
                  key={agent.registrationId}
                  label={agent.name || agent.kristoId}
                  sub={`${agent.kristoId} · ${agent.accessStatus} · makanisa ${agent.onboardings.churches} · yamethibitishwa ${agent.onboardings.byStatus.confirmed}`}
                  onPress={() =>
                    agent.userId
                      ? router.push({ pathname: "/more/uvumbuzi-program/team-agent", params: { userId: agent.userId } } as any)
                      : undefined
                  }
                />
              ))
            )}
          </ProgramCard>
          <ProgramCard title="Codes za kuamilisha makanisa">
            <Text style={programStyles.helper}>
              Zana za awali za Supervisor: codes kutoka kwa System Admin, kuzigawa kwa agents, na shughuli za hivi karibuni.
            </Text>
            <LinkRow
              label="Fungua codes na agents (zana za awali)"
              sub="Inventory • gawa codes • activity"
              onPress={() => router.push("/more/supervisor" as any)}
            />
          </ProgramCard>

          <Text style={[programStyles.helper, { color: PROGRAM_MUTED }]}>
            Unaona timu yako pekee. "Imethibitishwa" inaonyeshwa tu pale kiongozi wa kanisa mwenyewe amethibitisha.
          </Text>
        </>
      ) : null}
    </ProgramScreen>
  );
}
