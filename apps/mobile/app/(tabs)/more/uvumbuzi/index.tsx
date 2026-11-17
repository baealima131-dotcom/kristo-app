import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLabNotConnected, uvumbuziLab, type LabProjectSummary } from "@/src/lib/uvumbuziLabApi";
import { Button, Card, Chip, ErrorLine, Field, Notice, ROLE_LABEL, UV, UvScreen, s } from "@/src/features/uvumbuzi/ui";

type State =
  | { kind: "loading" }
  | { kind: "not_connected" }
  | { kind: "error"; message: string }
  | { kind: "ready"; subject: string; kristoId: string | null; projects: LabProjectSummary[] };

/** UVUMBUZI Lab: the viewer's invention projects, using their existing Kristo account. */
export default function UvumbuziProjectsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await uvumbuziLab.me();
    if (r.ok) setState({ kind: "ready", subject: r.data.subject, kristoId: r.data.kristoId ?? null, projects: r.data.projects });
    else if (isLabNotConnected(r)) setState({ kind: "not_connected" });
    else setState({ kind: "error", message: r.error });
  }, []);

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

  const open = (p: { id: string; name: string }) =>
    router.push({ pathname: "/more/uvumbuzi/[projectId]", params: { projectId: p.id, name: p.name } } as unknown as Href);

  const create = async () => {
    if (!name.trim()) return setFormError("Give the project a name.");
    setBusy(true);
    setFormError(null);
    const r = await uvumbuziLab.createProject(name.trim(), description.trim());
    setBusy(false);
    if (!r.ok) return setFormError(r.error);
    setName("");
    setDescription("");
    setCreating(false);
    await load();
    open(r.data);
  };

  return (
    <UvScreen title="UVUMBUZI Lab" subtitle="Invention projects • your Kristo account">
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={UV.teal} />}
      >
        {state.kind === "loading" ? (
          <View style={{ paddingTop: 60 }}>
            <ActivityIndicator color={UV.teal} />
          </View>
        ) : state.kind === "not_connected" ? (
          <Notice
            icon="flask-outline"
            title="UVUMBUZI Lab is not connected yet"
            text="Your Kristo account will open the Lab here as soon as it is switched on. No separate sign-up is needed."
          />
        ) : state.kind === "error" ? (
          <Notice
            icon="cloud-offline-outline"
            title="Could not reach the Lab"
            text={state.message}
            action={<Button label="Try again" kind="ghost" icon="refresh" onPress={() => { setState({ kind: "loading" }); void load(); }} />}
          />
        ) : (
          <>
            <Card>
              <View style={s.row}>
                <Ionicons name="person-circle-outline" size={20} color={UV.teal} />
                <Text style={s.h2}>Signed in with Kristo</Text>
              </View>
              <Text style={s.meta}>Your Kristo ID — share it with a project owner to be invited</Text>
              <Text selectable style={[s.body, { fontFamily: "Courier" }]}>{state.kristoId ?? state.subject}</Text>
            </Card>

            {creating ? (
              <Card>
                <Text style={s.h2}>New invention project</Text>
                <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Solar water pump" maxLength={200} />
                <Field label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} />
                <ErrorLine text={formError} />
                <View style={[s.row, { justifyContent: "flex-end" }]}>
                  <Button label="Cancel" kind="ghost" onPress={() => { setCreating(false); setFormError(null); }} />
                  <Button label="Create" icon="add" busy={busy} onPress={create} />
                </View>
              </Card>
            ) : (
              <Button label="New project" icon="add-circle-outline" onPress={() => setCreating(true)} />
            )}

            {state.projects.length === 0 ? (
              <Notice
                icon="bulb-outline"
                title="No projects yet"
                text="Create a project, or ask a project owner to add your Kristo ID as a collaborator."
              />
            ) : (
              state.projects.map((p) => (
                <Pressable key={p.id} onPress={() => open(p)} accessibilityRole="button" accessibilityLabel={`Open ${p.name}`}>
                  <Card>
                    <View style={[s.row, { justifyContent: "space-between" }]}>
                      <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                      <Chip label={ROLE_LABEL[p.role]} tone={p.role === "owner" ? "teal" : p.role === "leader" ? "amber" : "grey"} />
                    </View>
                    {p.description ? <Text style={s.meta} numberOfLines={2}>{p.description}</Text> : null}
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </UvScreen>
  );
}
