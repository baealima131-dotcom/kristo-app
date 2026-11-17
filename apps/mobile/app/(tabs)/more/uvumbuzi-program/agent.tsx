import React from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { GoldPrimaryButton } from "@/src/components/offlineActivationAdminDashboardUi";
import {
  ChoiceRow,
  LinkRow,
  MetaRow,
  ProgramCard,
  ProgramField,
  ProgramScreen,
  programStyles,
  StatusPill,
} from "@/src/components/uvumbuziProgramUi";
import {
  fetchAgentWork,
  saveChurchOnboarding,
  submitTrainingReport,
  type AgentWork,
  type FollowUpStatus,
  type ProgramChurch,
} from "@/src/lib/offlineActivationProgramApi";
import {
  FOLLOW_UP_LABEL,
  FOLLOW_UP_ORDER,
  parseTopics,
} from "@/src/lib/offlineActivationProgramLabels";

export default function UvumbuziAgentScreen() {
  const router = useRouter();
  const [work, setWork] = React.useState<AgentWork | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [leaderKristoId, setLeaderKristoId] = React.useState("");
  const [churchId, setChurchId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [openId, setOpenId] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setError("");
      setWork(await fetchAgentWork());
    } catch (e: any) {
      setError(String(e?.message || "Imeshindikana kupakia kazi zako"));
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

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await saveChurchOnboarding(leaderKristoId.trim().toUpperCase(), churchId.trim());
      setLeaderKristoId("");
      setChurchId("");
      setOpenId(result.onboarding.id);
      if (!result.created) Alert.alert("Tayari lipo", "Kanisa hili tayari liko kwenye orodha yako; halijarudiwa.");
      await load();
    } catch (e: any) {
      Alert.alert("Haikuhifadhiwa", String(e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProgramScreen
      title="Agent"
      subtitle="Makanisa ninayosaidia · Uvumbuzi"
      icon="business-outline"
      loading={loading}
      error={error}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      {work ? (
        <>
          <ProgramCard>
            <MetaRow label="Supervisor" value={work.supervisor.name || work.supervisor.kristoId || "—"} />
            <MetaRow label="Makanisa" value={work.summary.churches} />
            <MetaRow label="Kiongozi amethibitisha" value={work.summary.byStatus.confirmed} />
            <MetaRow label="Yanasubiri uthibitisho" value={work.summary.byStatus.awaiting_confirmation} />
          </ProgramCard>

          <ProgramCard title="Codes za kuamilisha makanisa">
            <LinkRow
              label="Fungua zana za awali za Agent"
              sub="Codes ulizopewa • amilisha kanisa kwa code"
              onPress={() => router.push("/more/agent" as any)}
            />
          </ProgramCard>

          <ProgramCard title="Alika / sajili kanisa">
            <Text style={programStyles.helper}>
              Kiongozi anasajili kanisa mwenyewe kupitia Kristo. Ukisaidia, hupati umiliki wala mamlaka ya kanisa.
            </Text>
            <ProgramField
              label="Kristo ID ya kiongozi"
              value={leaderKristoId}
              onChangeText={setLeaderKristoId}
              autoCapitalize="characters"
              placeholder="KR7-XXXXXX"
            />
            <ProgramField
              label="Church ID (kama limeshasajiliwa)"
              value={churchId}
              onChangeText={setChurchId}
              autoCapitalize="characters"
              placeholder="CH7-…"
            />
            <GoldPrimaryButton label="Hifadhi" onPress={() => void onSave()} loading={saving} disabled={!leaderKristoId.trim()} />
          </ProgramCard>

          {work.churches.map((church) => (
            <ChurchCard
              key={church.id}
              church={church}
              open={openId === church.id}
              onToggle={() => setOpenId(openId === church.id ? "" : church.id)}
              onSaved={load}
            />
          ))}
        </>
      ) : null}
    </ProgramScreen>
  );
}

function ChurchCard({
  church,
  open,
  onToggle,
  onSaved,
}: {
  church: ProgramChurch;
  open: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void>;
}) {
  const report = church.agentReport;
  const [churchId, setChurchId] = React.useState(church.churchId || "");
  const [topics, setTopics] = React.useState(report?.trainingTopics.join(", ") || "");
  const [notes, setNotes] = React.useState(report?.trainingNotes || "");
  const [completed, setCompleted] = React.useState<"yes" | "no">(report?.trainingCompleted ? "yes" : "no");
  const [followUp, setFollowUp] = React.useState<FollowUpStatus>(report?.followUpStatus || "none");
  const [followUpNote, setFollowUpNote] = React.useState(report?.followUpNote || "");
  const [busy, setBusy] = React.useState(false);
  const locked = church.status === "confirmed";

  const onSubmit = async () => {
    setBusy(true);
    try {
      const result = await submitTrainingReport({
        onboardingId: church.id,
        churchId: church.churchId ? undefined : churchId.trim().toUpperCase(),
        trainingTopics: parseTopics(topics),
        trainingNotes: notes,
        trainingCompleted: completed === "yes",
        followUpStatus: followUp,
        followUpNote,
      });
      Alert.alert(
        result.duplicate ? "Hakuna mabadiliko" : "Imetumwa",
        result.confirmationRequested
          ? "Kiongozi ataulizwa ndani ya Kristo kuthibitisha mafunzo."
          : result.duplicate
            ? "Ripoti hii tayari imetumwa."
            : "Ripoti imehifadhiwa."
      );
      await onSaved();
    } catch (e: any) {
      Alert.alert("Haikutumwa", String(e?.message || ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProgramCard>
      <Pressable onPress={onToggle} style={{ gap: 8 }}>
        <Text style={programStyles.strong}>{church.churchId || "Kanisa (bado halijasajiliwa)"}</Text>
        <StatusPill status={church.status} />
        <MetaRow label="Kiongozi" value={church.leaderKristoId} />
        {church.leaderConfirmation?.note ? (
          <Text style={programStyles.helper}>Kiongozi: “{church.leaderConfirmation.note}”</Text>
        ) : null}
      </Pressable>
      {open && !locked ? (
        <View style={{ gap: 10 }}>
          <View style={programStyles.divider} />
          {!church.churchId ? (
            <ProgramField label="Church ID" value={churchId} onChangeText={setChurchId} autoCapitalize="characters" placeholder="CH7-…" />
          ) : null}
          <ProgramField label="Mafunzo uliyotoa (tenganisha kwa koma)" value={topics} onChangeText={setTopics} placeholder="Kuingia, Kanisa, Live" />
          <ProgramField label="Maelezo" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
          <Text style={programStyles.helper}>Mafunzo yamekamilika?</Text>
          <ChoiceRow options={["no", "yes"]} value={completed} onChange={setCompleted} labels={{ no: "Bado", yes: "Ndiyo" }} />
          <Text style={programStyles.helper}>Ufuatiliaji</Text>
          <ChoiceRow options={FOLLOW_UP_ORDER} value={followUp} onChange={setFollowUp} labels={FOLLOW_UP_LABEL} />
          <ProgramField label="Maelezo ya ufuatiliaji" value={followUpNote} onChangeText={setFollowUpNote} maxLength={500} />
          <GoldPrimaryButton label="Tuma ripoti" onPress={() => void onSubmit()} loading={busy} />
        </View>
      ) : null}
    </ProgramCard>
  );
}
