import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  uvumbuziLab,
  type LabActivity,
  type LabProjectHistory,
  type LabProposal,
  type LabResult,
  type LabTask,
} from "@/src/lib/uvumbuziLabApi";
import {
  Button,
  Card,
  Chip,
  ErrorLine,
  Field,
  Notice,
  ProposalStatusChip,
  ROLE_LABEL,
  TaskStatusChip,
  UV,
  UvScreen,
  s,
  when,
  who,
} from "@/src/features/uvumbuzi/ui";

type Tab = "tasks" | "proposals" | "team" | "history";

/** One invention project: tasks, reports, corrections, proposals, team and history — actions follow the viewer's role. */
export default function UvumbuziProjectScreen() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LabProjectHistory | null>(null);
  const [me, setMe] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("tasks");

  const load = useCallback(async () => {
    const [h, m] = await Promise.all([uvumbuziLab.history(String(projectId)), uvumbuziLab.me()]);
    if (!h.ok) return setLoadError(h.error);
    setLoadError(null);
    setData(h.data);
    if (m.ok) setMe(m.data.subject);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const canManage = data?.role === "owner" || data?.role === "leader";
  const tabs: Array<[Tab, string]> = [
    ["tasks", "Tasks"],
    ["proposals", "Proposals"],
    ...(canManage ? ([["team", "Team"]] as Array<[Tab, string]>) : []),
    ["history", "History"],
  ];

  return (
    <UvScreen title={String(name || "Project")} subtitle={data ? `UVUMBUZI Lab • ${ROLE_LABEL[data.role]}` : "UVUMBUZI Lab"}>
      <View style={[s.row, { paddingHorizontal: 16, paddingBottom: 8, gap: 6 }]} accessibilityRole="tablist">
        {tabs.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tab === key ? UV.teal : "rgba(255,255,255,0.06)" }}
          >
            <Text style={{ color: tab === key ? UV.bg : UV.muted, fontWeight: "800", fontSize: 13 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={UV.teal} />}
        keyboardShouldPersistTaps="handled"
      >
        {loadError ? (
          <Notice icon="cloud-offline-outline" title="Could not load this project" text={loadError} action={<Button label="Try again" kind="ghost" icon="refresh" onPress={() => void load()} />} />
        ) : !data ? (
          <View style={{ paddingTop: 60 }}>
            <ActivityIndicator color={UV.teal} />
          </View>
        ) : tab === "tasks" ? (
          <TasksTab data={data} me={me} projectId={String(projectId)} reload={load} />
        ) : tab === "proposals" ? (
          <ProposalsTab data={data} me={me} projectId={String(projectId)} reload={load} />
        ) : tab === "team" ? (
          <TeamTab data={data} me={me} projectId={String(projectId)} reload={load} />
        ) : (
          <HistoryTab activity={data.activity} me={me} />
        )}
      </ScrollView>
    </UvScreen>
  );
}

type TabProps = { data: LabProjectHistory; me: string; projectId: string; reload: () => Promise<void> };

/** Run a Lab action; on success reload, on failure keep the form and show why. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<LabResult<unknown>>, after: () => Promise<void> | void) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setError(r.error), false;
    await after();
    return true;
  };
  return { busy, error, setError, run };
}

function TasksTab({ data, me, projectId, reload }: TabProps) {
  const canManage = data.role !== "member";
  const [assigning, setAssigning] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [assignee, setAssignee] = useState("");
  const a = useAction();
  const people = [data.ownerSubject, ...(data.members ?? []).map((m) => m.subject)];

  const assign = async () => {
    if (!title.trim() || !assignee) return a.setError("Add a title and choose who will do it.");
    const done = await a.run("assign", () => uvumbuziLab.createTask(projectId, title.trim(), details.trim(), assignee), reload);
    if (done) {
      setTitle("");
      setDetails("");
      setAssignee("");
      setAssigning(false);
    }
  };

  return (
    <>
      {canManage ? (
        assigning ? (
          <Card>
            <Text style={s.h2}>Assign a task</Text>
            <Field label="Task" value={title} onChangeText={setTitle} placeholder="e.g. Measure coil resistance" maxLength={200} />
            <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline maxLength={5000} />
            <Text style={s.label}>Assign to</Text>
            <View style={[s.row, { flexWrap: "wrap" }]}>
              {people.map((p) => (
                <Pressable key={p} onPress={() => setAssignee(p)} accessibilityRole="radio" accessibilityState={{ checked: assignee === p }}>
                  <Chip label={who(p, me)} tone={assignee === p ? "teal" : "grey"} />
                </Pressable>
              ))}
            </View>
            <ErrorLine text={a.error} />
            <View style={[s.row, { justifyContent: "flex-end" }]}>
              <Button label="Cancel" kind="ghost" onPress={() => setAssigning(false)} />
              <Button label="Assign" icon="send" busy={a.busy === "assign"} onPress={assign} />
            </View>
          </Card>
        ) : (
          <Button label="Assign a task" icon="add-circle-outline" onPress={() => setAssigning(true)} />
        )
      ) : null}
      {data.tasks.length === 0 ? (
        <Notice icon="checkbox-outline" title="No tasks yet" text={canManage ? "Assign the first task to someone on the team." : "Tasks assigned to you will appear here."} />
      ) : (
        data.tasks.map((t) => <TaskCard key={t.id} task={t} me={me} canReview={canManage && t.assigneeSubject !== me} reload={reload} />)
      )}
    </>
  );
}

function TaskCard({ task, me, canReview, reload }: { task: LabTask; me: string; canReview: boolean; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(task.status === "changes_requested" || (task.status === "assigned" && task.assigneeSubject === me));
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const a = useAction();
  const mine = task.assigneeSubject === me;
  const canReport = mine && (task.status === "assigned" || task.status === "changes_requested");
  const lastCorrection = [...task.decisions].reverse().find((d) => d.decision === "changes_requested");

  const report = async () => {
    if (!note.trim()) return a.setError("Write what you did.");
    const url = evidence.trim();
    if (url && !/^https:\/\//.test(url)) return a.setError("Evidence must be an https:// link.");
    const ok = await a.run("report", () => uvumbuziLab.submitReport(task.id, note.trim(), url || undefined), reload);
    if (ok) {
      setNote("");
      setEvidence("");
    }
  };
  const review = (decision: "approved" | "changes_requested") => {
    if (decision === "changes_requested" && !reason.trim()) return a.setError("Say what needs to change.");
    return a.run(decision, () => uvumbuziLab.reviewTask(task.id, decision, reason.trim()), reload);
  };

  return (
    <Card>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ gap: 8 }}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Text style={[s.h2, { flex: 1 }]}>{task.title}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={UV.muted} />
        </View>
        <View style={s.row}>
          <TaskStatusChip status={task.status} />
          <Text style={s.meta}>for {who(task.assigneeSubject, me)} • {when(task.createdAt)}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={{ gap: 10 }}>
          {task.details ? <Text style={s.body}>{task.details}</Text> : null}
          {task.status === "changes_requested" && lastCorrection ? (
            <View style={{ backgroundColor: UV.redSoft, borderRadius: 12, padding: 10, gap: 4 }}>
              <Text style={[s.label, { color: UV.red }]}>Correction requested by {who(lastCorrection.reviewerSubject, me)}</Text>
              <Text style={s.body}>{lastCorrection.reason || "Please revise and send again."}</Text>
            </View>
          ) : null}
          {task.reports.map((r) => (
            <View key={r.id} style={{ borderLeftWidth: 2, borderLeftColor: UV.teal, paddingLeft: 10, gap: 2 }}>
              <Text style={s.meta}>Report by {who(r.authorSubject, me)} • {when(r.createdAt)}</Text>
              <Text style={s.body}>{r.note}</Text>
              {r.evidenceUrl ? <Text selectable style={[s.meta, { color: UV.teal }]}>{r.evidenceUrl}</Text> : null}
            </View>
          ))}
          {canReport ? (
            <>
              <Field label="Progress report" value={note} onChangeText={setNote} multiline maxLength={5000} placeholder="What did you do? What did you measure?" />
              <Field label="Evidence link (optional, https)" value={evidence} onChangeText={setEvidence} autoCapitalize="none" keyboardType="url" placeholder="https://…" />
              <Button label="Send report" icon="send" busy={a.busy === "report"} onPress={report} />
            </>
          ) : null}
          {canReview && task.status === "submitted" ? (
            <>
              <Field label="Review note (needed to request changes)" value={reason} onChangeText={setReason} multiline maxLength={2000} />
              <View style={[s.row, { justifyContent: "flex-end" }]}>
                <Button label="Request changes" kind="danger" busy={a.busy === "changes_requested"} onPress={() => void review("changes_requested")} />
                <Button label="Approve" icon="checkmark" busy={a.busy === "approved"} onPress={() => void review("approved")} />
              </View>
            </>
          ) : null}
          <ErrorLine text={a.error} />
        </View>
      ) : null}
    </Card>
  );
}

function ProposalsTab({ data, me, projectId, reload }: TabProps) {
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const a = useAction();

  const propose = async () => {
    if (!title.trim() || !summary.trim()) return a.setError("Add a title and describe the change.");
    const ok = await a.run("propose", () => uvumbuziLab.propose(projectId, title.trim(), summary.trim()), reload);
    if (ok) {
      setTitle("");
      setSummary("");
      setWriting(false);
    }
  };

  return (
    <>
      <Text style={s.meta}>Major design changes are proposed here and decided by the project owner. Approving records the decision; it does not change the design automatically.</Text>
      {writing ? (
        <Card>
          <Text style={s.h2}>Propose a change</Text>
          <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
          <Field label="What and why" value={summary} onChangeText={setSummary} multiline maxLength={5000} />
          <ErrorLine text={a.error} />
          <View style={[s.row, { justifyContent: "flex-end" }]}>
            <Button label="Cancel" kind="ghost" onPress={() => setWriting(false)} />
            <Button label="Submit" icon="send" busy={a.busy === "propose"} onPress={propose} />
          </View>
        </Card>
      ) : (
        <Button label="Propose a change" icon="git-pull-request-outline" onPress={() => setWriting(true)} />
      )}
      {data.proposals.length === 0 ? (
        <Notice icon="document-text-outline" title="No proposals" text="Nothing has been proposed yet." />
      ) : (
        data.proposals.map((p) => <ProposalCard key={p.id} p={p} me={me} isOwner={data.role === "owner"} reload={reload} />)
      )}
    </>
  );
}

function ProposalCard({ p, me, isOwner, reload }: { p: LabProposal; me: string; isOwner: boolean; reload: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const a = useAction();
  const pending = p.status === "pending";
  const decide = (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reason.trim()) return a.setError("A rejection needs a reason.");
    return a.run(decision, () => uvumbuziLab.decideProposal(p.id, decision, reason.trim()), reload);
  };
  return (
    <Card>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Text style={[s.h2, { flex: 1 }]}>{p.title}</Text>
        <ProposalStatusChip status={p.status} />
      </View>
      <Text style={s.body}>{p.summary}</Text>
      <Text style={s.meta}>by {who(p.proposerSubject, me)} • {when(p.createdAt)}</Text>
      {p.decisionReason ? <Text style={s.body}>Owner: {p.decisionReason}</Text> : null}
      {pending && isOwner ? (
        <>
          <Field label="Decision note (needed to reject)" value={reason} onChangeText={setReason} multiline maxLength={2000} />
          <View style={[s.row, { justifyContent: "flex-end" }]}>
            <Button label="Reject" kind="danger" busy={a.busy === "rejected"} onPress={() => void decide("rejected")} />
            <Button label="Approve" icon="checkmark" busy={a.busy === "approved"} onPress={() => void decide("approved")} />
          </View>
        </>
      ) : null}
      {pending && p.proposerSubject === me ? (
        <Button label="Withdraw" kind="ghost" busy={a.busy === "withdraw"} onPress={() => void a.run("withdraw", () => uvumbuziLab.withdrawProposal(p.id), reload)} />
      ) : null}
      <ErrorLine text={a.error} />
    </Card>
  );
}

function TeamTab({ data, me, projectId, reload }: TabProps) {
  const isOwner = data.role === "owner";
  const [subject, setSubject] = useState("");
  const a = useAction();
  const add = async () => {
    const id = subject.trim();
    if (!id) return a.setError("Enter the person's Lab ID (shown on their UVUMBUZI Lab screen).");
    const ok = await a.run("add", () => uvumbuziLab.addMember(projectId, id), reload);
    if (ok) setSubject("");
  };
  return (
    <>
      <Card>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Text style={s.body}>{who(data.ownerSubject, me)}</Text>
          <Chip label="Owner" />
        </View>
        {(data.members ?? []).map((m) => (
          <View key={m.subject} style={[s.row, { justifyContent: "space-between" }]}>
            <Text style={[s.body, { flex: 1 }]}>{who(m.subject, me)}</Text>
            {isOwner ? (
              <Pressable
                onPress={() => void a.run(m.subject, () => uvumbuziLab.setRole(projectId, m.subject, m.role === "leader" ? "member" : "leader"), reload)}
                accessibilityRole="button"
                accessibilityLabel={m.role === "leader" ? "Make member" : "Make leader"}
              >
                <Chip label={a.busy === m.subject ? "…" : `${ROLE_LABEL[m.role]} ⇄`} tone={m.role === "leader" ? "amber" : "grey"} />
              </Pressable>
            ) : (
              <Chip label={ROLE_LABEL[m.role]} tone={m.role === "leader" ? "amber" : "grey"} />
            )}
          </View>
        ))}
      </Card>
      {isOwner ? (
        <Card>
          <Text style={s.h2}>Add a collaborator</Text>
          <Field label="Their Lab ID" value={subject} onChangeText={setSubject} autoCapitalize="none" autoCorrect={false} placeholder="u_…" />
          <Text style={s.meta}>Leaders can assign tasks and review reports. Only you can add people, change roles and decide proposals.</Text>
          <Button label="Add" icon="person-add-outline" busy={a.busy === "add"} onPress={add} />
        </Card>
      ) : null}
      <ErrorLine text={a.error} />
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  project_created: "created the project",
  project_linked: "linked the project",
  member_added: "added a collaborator",
  role_changed: "changed a role",
  task_assigned: "assigned a task",
  report_submitted: "sent a report",
  task_approved: "approved a task",
  changes_requested: "requested a correction",
  proposal_created: "proposed a change",
  proposal_approved: "approved a proposal",
  proposal_rejected: "rejected a proposal",
  proposal_withdrawn: "withdrew a proposal",
};

function HistoryTab({ activity, me }: { activity: LabActivity[]; me: string }) {
  if (!activity.length) return <Notice icon="time-outline" title="No history yet" text="Project events will be listed here." />;
  return (
    <Card>
      {[...activity].reverse().map((e) => (
        <View key={e.seq} style={{ gap: 2, paddingVertical: 4 }}>
          <Text style={s.body}>
            <Text style={{ fontWeight: "800" }}>{who(e.actorSubject, me)}</Text> {ACTION_LABEL[e.action] ?? e.action}
            {e.detail && e.action !== "report_submitted" && e.action !== "task_assigned" ? ` — ${e.detail}` : ""}
          </Text>
          <Text style={s.meta}>{when(e.createdAt)}</Text>
        </View>
      ))}
    </Card>
  );
}
