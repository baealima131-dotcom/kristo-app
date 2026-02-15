import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { VipScreen, VipText } from "@/src/ui/VipKit";

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
};

async function apiGetMinistries() {
  const res = await apiGet<{ ok: true; data: Ministry[] }>("/api/church/ministries", {
    headers: getKristoHeaders(),
  });
  if (!res?.ok) throw new Error((res as any)?.error || "Failed to load ministries");
  return res.data;
}

export default function MinistryDetails() {
  const router = useRouter();
  const { ministryId } = useLocalSearchParams<{ ministryId: string }>();

  const id = useMemo(() => String(ministryId ?? ""), [ministryId]);

  const [item, setItem] = useState<Ministry | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const all = await apiGetMinistries();
      const found = all.find( (m: any) => m.id === id) || null;
      setItem(found);
      if (!found) setErr("Ministry not found (maybe deleted or different church).");
    } catch (e: any) {
      setErr(e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  return (
    <VipScreen>
      <View style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
          <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.88)" />
        </Pressable>
        <VipText tone="h1">Ministry</VipText>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 10 }}>
          <ActivityIndicator />
          <VipText tone="mut">Loading…</VipText>
        </View>
      ) : err ? (
        <View style={{ padding: 16, gap: 10 }}>
          <VipText tone="mut">{err}</VipText>
          <Pressable
            onPress={load}
            style={{
              marginTop: 6,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              backgroundColor: "rgba(255,255,255,0.04)",
              alignSelf: "flex-start",
            }}
          >
            <VipText>Retry</VipText>
          </Pressable>
          <VipText tone="mut">ID: {id}</VipText>
        </View>
      ) : (
        <View style={{ padding: 16, gap: 10 }}>
          <VipText tone="h2">{item?.name}</VipText>
          <VipText tone="mut">{item?.description ? item.description : "No description"}</VipText>
          <VipText tone="mut">Status: {item?.status}</VipText>
          <VipText tone="mut">ID: {item?.id}</VipText>
        </View>
      )}
    </VipScreen>
  );
}
