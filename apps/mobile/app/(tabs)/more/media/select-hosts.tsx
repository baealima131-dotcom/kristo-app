import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { loadSession, saveSession, setSessionSync } from "@/src/lib/kristoSession";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { saveChurchMediaProfileCache } from "@/src/lib/churchMediaProfileStore";

type Member = {
  id?: string;
  membershipId?: string;
  userId: string;
  name?: string;
  displayName?: string;
  role?: string;
  roleLabel?: string;
  avatarUrl?: string;
  avatarUri?: string;
  kristoId?: string;
  userCode?: string;
};

const API_BASE = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");

function imgUrl(u?: string) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return API_BASE ? `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}` : u;
}

function isPastorLockedHost(host: any) {
  const role = String(host?.role || host?.roleLabel || "").toLowerCase();
  return role.includes("pastor");
}

export default function SelectHosts() {
  const router = useRouter();
  const [hosts, setHosts] = useState<any[]>([null, null, null]);
  const [members, setMembers] = useState<Member[]>([]);
  const [session, setLocalSession] = useState<any>(null);
  const [media, setMedia] = useState<any>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const canManageHosts =
    String(session?.role || "").toLowerCase().includes("pastor");

  async function loadAll() {
    const sess: any = await loadSession();
    setLocalSession(sess);
    if (!sess?.userId || !sess?.churchId) return;

    const headers = getKristoHeaders({
      userId: sess.userId,
      role: sess.role || "Member",
      churchId: sess.churchId || "",
    });

    const [membersRes, mediaRes]: any[] = await Promise.all([
      apiGet("/api/church/members?all=1", { headers }),
      apiGet("/api/church/media", { headers }),
    ]);

    const list = Array.isArray(membersRes)
      ? membersRes
      : membersRes?.data || membersRes?.members || membersRes?.items || [];

    setMembers(Array.isArray(list) ? list : []);

    if (mediaRes?.ok && mediaRes?.media) {
      setMedia(mediaRes.media);
      const savedHosts = Array.isArray(mediaRes.media.hosts) ? mediaRes.media.hosts.slice(0, 3) : [];
      setHosts([savedHosts[0] || null, savedHosts[1] || null, savedHosts[2] || null]);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const selectedIds = hosts.filter(Boolean).map((h: any) => String(h?.userId || ""));

  function addHost(member: Member) {
    if (!canManageHosts) return;
    if (activeSlot === null) return;
    setHosts((prev) => {
      const next = [...prev];
      next[activeSlot] = {
        userId: member.userId,
        name: member.name || member.displayName || "Church member",
        role: member.role || member.roleLabel || "Member",
        avatarUrl: member.avatarUrl || member.avatarUri || "",
        kristoId: member.kristoId || member.userCode || "",
      };
      return next;
    });
    setActiveSlot(null);
  }

  function removeHost(index: number) {
    if (!canManageHosts) return;
    setHosts((prev) => {
      const current = prev[index];
      if (isPastorLockedHost(current)) return prev;

      const next = [...prev];
      next[index] = null;
      return next;
    });
  }

  async function saveHosts() {
    if (!canManageHosts) return;
    if (!session?.userId || !session?.churchId || !media?.mediaName) return;

    const nextHosts = hosts.filter(Boolean).slice(0, 3);
    const res: any = await apiPost(
      "/api/church/media",
      { ...media, id: media.id, ownerUserId: media.ownerUserId || session.userId, hosts: nextHosts },
      {
        headers: getKristoHeaders({
          userId: session.userId,
          role: session.role || "Pastor",
          churchId: session.churchId || "",
        }),
      }
    );

    if (res?.ok && res?.media) {
      const savedMedia = res.media;

      setMedia(savedMedia);
      setHosts([
        savedMedia.hosts?.[0] || null,
        savedMedia.hosts?.[1] || null,
        savedMedia.hosts?.[2] || null,
      ]);

      await saveChurchMediaProfileCache({
        ...savedMedia,
        churchId: String(savedMedia.churchId || session.churchId || ""),
      });

      const nextSession = {
        ...session,
        mediaProfile: savedMedia,
        churchMediaProfile: savedMedia,
      } as any;

      await saveSession(nextSession);
      setSessionSync(nextSession);
      setLocalSession(nextSession);

      router.back();
    }
  }

  return (
    <View style={{ flex: 1, padding: 18, backgroundColor: "#020817" }}>
      <View style={{ marginTop: 34, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 42,
            height: 42,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(244,201,93,0.25)",
          }}
        >
          <Text style={{ color: "#F4D06F", fontSize: 22, fontWeight: "900" }}>‹</Text>
        </Pressable>

        <Text style={{ flex: 1, fontSize: 26, fontWeight: "900", color: "#F4D06F" }}>
          Media Hosts
        </Text>
      </View>

      <Text style={{ color: "rgba(255,255,255,0.62)", marginTop: 6, marginBottom: 22, fontWeight: "800", lineHeight: 18 }}>
        Add up to 3 trusted church members to help pastor manage live and schedules.
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
        {hosts.map((host, index) => {
          const lockedPastor = isPastorLockedHost(host);

          return (
          <View
            key={index}
            style={{
              marginBottom: 16,
              padding: 18,
              borderRadius: 28,
              backgroundColor: "rgba(255,255,255,0.045)",
              borderWidth: 1.4,
              borderColor: host
                ? "rgba(244,201,93,0.55)"
                : "rgba(255,255,255,0.10)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                position: "absolute",
                top: -36,
                right: -28,
                width: 104,
                height: 104,
                borderRadius: 999,
                backgroundColor: host
                  ? "rgba(244,201,93,0.10)"
                  : "rgba(255,255,255,0.03)",
              }}
            />

            <Text
              style={{
                color: "rgba(255,208,111,0.95)",
                fontWeight: "900",
                letterSpacing: 1.2,
                fontSize: 12,
              }}
            >
              HOST SLOT {index + 1}
            </Text>

            <View
              style={{
                marginTop: 7,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              {host?.avatarUrl ? (
                <Image
                  source={{ uri: imgUrl(host.avatarUrl) }}
                  style={{
                    width: 66,
                    height: 50,
                    borderRadius: 999,
                    borderWidth: 2,
                    borderColor: "#F4C95D",
                  }}
                />
              ) : (
                <View
                  style={{
                    width: 66,
                    height: 50,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(244,201,93,0.12)",
                    borderWidth: 2,
                    borderColor: "rgba(244,201,93,0.45)",
                  }}
                >
                  <Text
                    style={{
                      color: "#F4D06F",
                      fontWeight: "900",
                      fontSize: 20,
                    }}
                  >
                    {host?.name
                      ? String(host.name).slice(0, 1).toUpperCase()
                      : "+"}
                  </Text>
                </View>
              )}

              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 20,
                    fontWeight: "900",
                  }}
                  numberOfLines={1}
                >
                  {host ? host.name : "Empty host"}
                </Text>

                <Text
                  style={{
                    marginTop: 4,
                    color: "rgba(255,255,255,0.60)",
                    fontWeight: "800",
                  }}
                >
                  {host ? host.role : "No member selected yet"}
                </Text>

                {host?.kristoId ? (
                  <View
                    style={{
                      alignSelf: "flex-start",
                      marginTop: 7,
                      paddingHorizontal: 12,
                      height: 30,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(244,201,93,0.14)",
                      borderWidth: 1,
                      borderColor: "rgba(244,201,93,0.30)",
                    }}
                  >
                    <Text
                      style={{
                        color: "#F4D06F",
                        fontWeight: "900",
                        letterSpacing: 0.5,
                        fontSize: 12,
                      }}
                    >
                      {host.kristoId}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <Pressable
              disabled={lockedPastor || !canManageHosts}
              onPress={() =>
                host ? removeHost(index) : setActiveSlot(index)
              }
              style={{
                marginTop: 12,
                height: 50,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: lockedPastor || !canManageHosts
                  ? "rgba(244,201,93,0.16)"
                  : host
                  ? "rgba(255,255,255,0.07)"
                  : "#F4C95D",
                borderWidth: 1,
                borderColor: lockedPastor || !canManageHosts
                  ? "rgba(244,201,93,0.40)"
                  : host
                  ? "rgba(255,255,255,0.14)"
                  : "rgba(244,201,93,0.7)",
                opacity: lockedPastor || !canManageHosts ? 0.95 : 1,
              }}
            >
              <Text
                style={{
                  color: lockedPastor || !canManageHosts ? "#F4D06F" : host ? "#fff" : "#05070B",
                  fontWeight: "900",
                  fontSize: 14,
                }}
              >
                {lockedPastor ? "Pastor Locked" : !canManageHosts ? "Owner Only" : host ? "Remove Host" : "Add Host"}
              </Text>
            </Pressable>
          </View>
          );
        })}

        <Pressable
          disabled={!canManageHosts}
          onPress={saveHosts}
          style={{
            height: 50,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canManageHosts ? "#F4C95D" : "rgba(244,201,93,0.18)",
            marginTop: 8,
            borderWidth: canManageHosts ? 0 : 1,
            borderColor: "rgba(244,201,93,0.35)",
          }}
        >
          <Text style={{ color: canManageHosts ? "#05070B" : "#F4D06F", fontWeight: "900", fontSize: 16 }}>
            {canManageHosts ? "Save Hosts" : "Owner Only"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={activeSlot !== null} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" }}>
          <View style={{ maxHeight: "78%", padding: 18, paddingBottom: 34, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: "#07101E" }}>
            <Text style={{ color: "#F4D06F", fontSize: 24, fontWeight: "900" }}>Choose church member</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {members.map((m) => {
                const id = String(m.userId || "");
                const used = selectedIds.includes(id);
                const avatar = imgUrl(m.avatarUrl || m.avatarUri);
                return (
                  <Pressable key={m.id || m.membershipId || id} disabled={used} onPress={() => addHost(m)} style={{ marginTop: 12, padding: 18, borderRadius: 28, backgroundColor: used ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: used ? "rgba(255,255,255,0.05)" : "rgba(244,201,93,0.20)", opacity: used ? 0.45 : 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    {avatar ? <Image source={{ uri: avatar }} style={{ width: 42, height: 42, borderRadius: 999 }} /> : <View style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: "rgba(244,201,93,0.16)" }} />}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontSize: 17, fontWeight: "900" }}>{m.name || m.displayName || "Church member"}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.55)", marginTop: 4, fontWeight: "800" }}>{used ? "Already selected" : m.role || m.roleLabel || "Member"}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable onPress={() => setActiveSlot(null)} style={{ marginTop: 16, height: 50, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
