import React, { useEffect, useMemo, useState, useCallback } from "react";
import { fetchMyActiveChurchMembership } from "@/src/lib/churchMembersApi";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Modal, Alert, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { apiGet, apiPatch } from "@/src/lib/kristoApi";
import { handleInviteAction } from "@/src/lib/churchMembersApi";
import { useIsFocused } from "@react-navigation/native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadChurchProfileCache, saveChurchProfileCache } from "@/src/lib/churchStore";
import { onChurchProfileUpdated } from "@/src/lib/kristoProfileEvents";
import { avatarCacheBust, pickFresherAvatar } from "@/src/lib/avatarFreshness";

const VIP_BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.72)";

type OverviewStats = {
  activeMembers: number;
  ministries: number;
  ministryMembers: number;
  unreadNotifications: number;
  offeringBalance: number;
};

function mediaUrl(u: any) {
  const v = String(u || "").trim();
  if (!v) return "";
  if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v) || v.startsWith("file://")) return v;

  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

type ChurchProfile = {
  id?: string;
  name?: string;
  address?: string;
  phone?: string;
  pastorName?: string;
  avatarUri?: string;
  avatarUpdatedAt?: number;
};

function profileFromCache(churchId: string, cached: Awaited<ReturnType<typeof loadChurchProfileCache>>): ChurchProfile | null {
  if (!cached) return null;
  const avatarUri = String(cached.avatarUri || cached.avatarUrl || "").trim();
  return {
    id: churchId,
    name: String(cached.name || churchId),
    address: String(cached.address || ""),
    phone: String(cached.phone || ""),
    pastorName: String(cached.pastorName || ""),
    avatarUri: avatarUri ? mediaUrl(avatarUri) : "",
    avatarUpdatedAt: cached.avatarUpdatedAt,
  };
}

type MediaMinistryTarget = {
  id: string;
  name: string;
  mediaAccess?: boolean;
};

export default function ChurchOverviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const isFocused = useIsFocused();
  const { session, setSession } = useKristoSession();
  const refreshAt = String(params.refreshAt || "");
  const inviteId = String(params.inviteId || "").trim();
  const inviteStatus = String(params.inviteStatus || "Pending").trim().toLowerCase();

  const auth = getKristoAuth();
  const invitePreview = String(params.invitePreview || "") === "1";
  const paramChurchId = String(params.churchId || "").trim();

  useEffect(() => {
    let alive = true;

    async function refreshMembership() {
      try {
        const mine = await fetchMyActiveChurchMembership();
        if (!alive || !mine.churchId) return;

        await setSession({
          ...session,
          churchId: mine.churchId,
          role: mine.role || "Member",
          churchRole: mine.role || "Member",
          activeChurchId: mine.churchId,
        } as any);
      } catch {}
    }

    if (!String(session?.churchId || "").trim()) {
      void refreshMembership();
    }

    return () => {
      alive = false;
    };
  }, [session?.userId, session?.churchId]);

  const churchId = String(
    paramChurchId ||
      session?.churchId ||
      (session as any)?.activeChurchId ||
      ""
  ).trim();
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

  // Preview should READ the invited church like admin so data matches,
  // but UI actions remain locked by invitePreview.
  const effectiveAuthUserId = invitePreview
    ? String(auth?.userId || "preview-user")
    : String(auth?.userId || "");

  const effectiveAuthRole = invitePreview
    ? "Church_Admin"
    : String(auth?.role || "Member");

  const getHeaders = () => ({
    accept: "application/json",
    "x-kristo-user-id": effectiveAuthUserId,
    "x-kristo-role": effectiveAuthRole,
    "x-kristo-church-id": churchId,
  });

  const logOverviewRequest = (url: string) => {
    if (!__DEV__) return;
    const h = getHeaders();
    console.log("[ChurchOverview] fetch", {
      url,
      "x-kristo-user-id": h["x-kristo-user-id"],
      "x-kristo-role": h["x-kristo-role"],
      "x-kristo-church-id": h["x-kristo-church-id"],
      sessionChurchId: session?.churchId || "",
      paramChurchId,
    });
  };

  const [stats, setStats] = useState<OverviewStats>({
    activeMembers: 0,
    ministries: 0,
    ministryMembers: 0,
    unreadNotifications: 0,
    offeringBalance: 0,
  });
  const [profile, setProfile] = useState<ChurchProfile>({
    id: "",
    name: "",
    address: "",
    phone: "",
    pastorName: "",
    avatarUri: "",
    avatarUpdatedAt: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState("");
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaTargets, setMediaTargets] = useState<MediaMinistryTarget[]>([]);
  const [mediaTargetsLoading, setMediaTargetsLoading] = useState(false);
  const [mediaTargetsSaved, setMediaTargetsSaved] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<"manage" | "studio">("studio");
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [previewChecked, setPreviewChecked] = useState(!invitePreview);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewLimitReached, setPreviewLimitReached] = useState(false);

  useEffect(() => {
    let alive = true;

    async function checkPreviewLimit() {
      if (!invitePreview) {
        setPreviewChecked(true);
        setPreviewLimitReached(false);
        return;
      }

      const keyChurch = churchId || paramChurchId || "unknown-church";
      const keyInvite = inviteId || "no-invite";
      const keyUser = String(session?.userId || auth?.userId || "preview-user");
      const storageKey = `kristo:invite-preview-count:${keyUser}:${keyChurch}:${keyInvite}`;

      try {
        const current = Number(await AsyncStorage.getItem(storageKey) || "0");

        if (!alive) return;

        if (current >= 3) {
          setPreviewCount(current);
          setPreviewLimitReached(true);
          setPreviewChecked(true);
          return;
        }

        const next = current + 1;
        await AsyncStorage.setItem(storageKey, String(next));

        if (!alive) return;
        setPreviewCount(next);
        setPreviewLimitReached(false);
        setPreviewChecked(true);
      } catch {
        if (!alive) return;
        setPreviewCount(1);
        setPreviewLimitReached(false);
        setPreviewChecked(true);
      }
    }

    void checkPreviewLimit();

    return () => {
      alive = false;
    };
  }, [invitePreview, churchId, paramChurchId, inviteId, session?.userId, auth?.userId]);

  async function acceptPreviewInvite() {

    if (acceptingInvite) return;

    if (!inviteId) {
      Alert.alert("Invite missing", "This preview opened without an inviteId. Go back to Me → Invitations and tap View Profile again.");
      return;
    }
    const canAcceptInvite = inviteStatus === "pending" || inviteStatus === "requested";
    if (!canAcceptInvite) {
      Alert.alert("Invite not pending", `This invite is already ${inviteStatus}.`);
      return;
    }

    try {
      setAcceptingInvite(true);
      await handleInviteAction(inviteId, "accept");

      if (session?.userId) {
        await setSession({
          ...session,
          churchId,
          role: session.role || "Member",
        });
      }

      router.replace({ pathname: "/church/overview", params: { refreshAt: String(Date.now()) } } as any);
    } catch (e: any) {
      const msg = String(e?.message || e);

      if (msg.toLowerCase().includes("rejected")) {
        Alert.alert("Invite closed", "This invite was already rejected.");
        router.replace("/profile" as any);
        return;
      }

      Alert.alert("Accept failed", msg);
    } finally {
      setAcceptingInvite(false);
    }
  }

  useEffect(() => {
    if (!churchId) return;
    let alive = true;

    (async () => {
      const cached = await loadChurchProfileCache(churchId);
      if (!alive || !cached) return;
      const next = profileFromCache(churchId, cached);
      if (next) setProfile(next);
    })();

    return () => {
      alive = false;
    };
  }, [churchId, refreshAt]);

  async function load(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;
    if (silent) setRefreshing(true);
    else setLoading(true);

    setErr(null);

    try {
      if (!churchId) throw new Error("churchId missing");
      if (!effectiveAuthUserId) throw new Error("userId missing");

      const cached = await loadChurchProfileCache(churchId);
      if (cached) {
        const fromCache = profileFromCache(churchId, cached);
        if (fromCache) {
          setProfile(fromCache);
          if (!silent) setLoading(false);
        }
      }

      const overviewUrl = invitePreview
        ? `${base}/api/church/overview?invitePreview=1&inviteId=${encodeURIComponent(inviteId)}`
        : `${base}/api/church/overview`;

      logOverviewRequest(overviewUrl);

      const res = await fetch(overviewUrl, {
        method: "GET",
        headers: getHeaders(),
      });
      const j = await res.json().catch(() => ({} as any));

      if (!j?.ok) {
        if (__DEV__) {
          console.warn("[ChurchOverview] rejected", {
            status: res.status,
            error: (j as any)?.error,
            details: (j as any)?.details,
          });
        }
        throw new Error(String((j as any)?.error || "Fetch failed"));
      }

      const s = j?.data?.stats || {};
      const p = j?.data?.profile || {};
      setStats({
        activeMembers: Number(s?.activeMembers || 0),
        ministries: Number(s?.ministries || 0),
        ministryMembers: Number(s?.ministryMembers || 0),
        unreadNotifications: Number(s?.unreadNotifications || 0),
        offeringBalance: Number(s?.offeringBalance || 0),
      });
      const serverAvatarRaw = String(
        p?.avatarUri ||
        p?.avatarUrl ||
        p?.profileImage ||
        p?.profilePhoto ||
        p?.photo ||
        p?.image ||
        ""
      ).trim();

      const mergedAvatar = pickFresherAvatar({
        localUri: cached?.avatarUri || cached?.avatarUrl || "",
        localUpdatedAt: cached?.avatarUpdatedAt,
        serverUri: serverAvatarRaw,
        serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
      });

      if (mergedAvatar.skippedStale) {
        console.log("[ChurchOverview] skipped stale server avatar", {
          churchId,
          localUpdatedAt: cached?.avatarUpdatedAt || null,
          serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
        });
      }

      const nextAvatar = mergedAvatar.uri ? mediaUrl(mergedAvatar.uri) : "";
      const nextAvatarUpdatedAt =
        mergedAvatar.source === "local" ? cached?.avatarUpdatedAt : nextAvatar ? Date.now() : cached?.avatarUpdatedAt;

      setProfile({
        id: String(p?.id || churchId || ""),
        name: String(p?.name || churchId || "Church"),
        address: String(p?.address || ""),
        phone: String(p?.phone || ""),
        pastorName: String(p?.pastorName || ""),
        avatarUri: nextAvatar,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      });

      await saveChurchProfileCache({
        churchId,
        name: String(p?.name || churchId || "Church"),
        address: String(p?.address || ""),
        phone: String(p?.phone || ""),
        pastorName: String(p?.pastorName || ""),
        avatarUri: nextAvatar,
        avatarUrl: nextAvatar,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Error");

      if (invitePreview && msg.toLowerCase().includes("no active church membership")) {
        setProfile({
          id: churchId || paramChurchId || "",
          name: String(params.churchName || "Church Preview"),
          address: "",
          phone: "",
          pastorName: "",
          avatarUri: "",
        });
        setStats({
          activeMembers: 0,
          ministries: 0,
          ministryMembers: 0,
          unreadNotifications: 0,
          offeringBalance: 0,
        });
        setErr(null);
      } else {
        setErr(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const silentRefreshProfile = useCallback(async () => {
    if (!churchId || !effectiveAuthUserId) return;

    const cached = await loadChurchProfileCache(churchId);
    if (cached) {
      const fromCache = profileFromCache(churchId, cached);
      if (fromCache) setProfile(fromCache);
    }

    try {
      const j = await apiGet<any>("/api/church/profile", {
        headers: getKristoHeaders(),
      }).catch(() => null);

      if (!j?.ok) return;

      const p = j?.data || j?.profile || {};
      const serverAvatarRaw = String(p?.avatarUri || p?.avatarUrl || "").trim();
      const mergedAvatar = pickFresherAvatar({
        localUri: cached?.avatarUri || cached?.avatarUrl || "",
        localUpdatedAt: cached?.avatarUpdatedAt,
        serverUri: serverAvatarRaw,
        serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
      });

      if (mergedAvatar.skippedStale) {
        console.log("[ChurchOverview] skipped stale server avatar", {
          churchId,
          localUpdatedAt: cached?.avatarUpdatedAt || null,
          serverUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0),
        });
      }

      const nextAvatar = mergedAvatar.uri ? mediaUrl(mergedAvatar.uri) : "";
      const nextAvatarUpdatedAt =
        mergedAvatar.source === "local" ? cached?.avatarUpdatedAt : nextAvatar ? Date.now() : cached?.avatarUpdatedAt;

      const nextProfile: ChurchProfile = {
        id: String(p?.id || churchId),
        name: String(p?.name || churchId),
        address: String(p?.address || ""),
        phone: String(p?.phone || ""),
        pastorName: String(p?.pastorName || ""),
        avatarUri: nextAvatar,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      };

      setProfile(nextProfile);

      await saveChurchProfileCache({
        churchId,
        name: nextProfile.name,
        address: nextProfile.address,
        phone: nextProfile.phone,
        pastorName: nextProfile.pastorName,
        avatarUri: nextProfile.avatarUri,
        avatarUrl: nextProfile.avatarUri,
        avatarUpdatedAt: nextAvatarUpdatedAt,
      });

      if (session && nextProfile.name) {
        await setSession({
          ...session,
          churchName: nextProfile.name,
        } as any);
      }

      console.log("[ChurchOverview] silent refresh applied", {
        churchId,
        name: nextProfile.name,
        hasAvatar: Boolean(nextProfile.avatarUri),
      });
    } catch {}
  }, [churchId, effectiveAuthUserId, session, setSession]);

  const applyChurchProfileEvent = useCallback(
    async (payload: { name?: string; avatarUri?: string; avatarUrl?: string; avatarUpdatedAt?: number }) => {
      const cached = await loadChurchProfileCache(churchId);
      const avatarRaw =
        String(payload.avatarUri || payload.avatarUrl || cached?.avatarUri || cached?.avatarUrl || "").trim();
      const nextAvatar = avatarRaw ? mediaUrl(avatarRaw) : "";
      setProfile((prev) => ({
        ...prev,
        name: String(payload.name || cached?.name || prev.name || churchId),
        avatarUri: nextAvatar || prev.avatarUri,
        avatarUpdatedAt: payload.avatarUpdatedAt || cached?.avatarUpdatedAt || prev.avatarUpdatedAt,
      }));
      console.log("[ChurchOverview] event applied immediately", {
        churchId,
        hasAvatar: Boolean(nextAvatar),
        avatarUpdatedAt: payload.avatarUpdatedAt || cached?.avatarUpdatedAt || null,
      });
    },
    [churchId]
  );

  useEffect(() => {
    if (!isFocused) return;
    if (invitePreview && !previewChecked) return;
    if (invitePreview && previewLimitReached) {
      setLoading(false);
      setErr(null);
      return;
    }
    load({ silent: !loading });
  }, [isFocused, refreshAt, invitePreview, previewChecked, previewLimitReached]);

  useEffect(() => {
    if (!isFocused) return;
    void silentRefreshProfile();
  }, [isFocused, refreshAt, silentRefreshProfile]);

  useEffect(() => {
    return onChurchProfileUpdated((payload) => {
      if (String(payload.churchId || "").trim() !== churchId) return;
      void applyChurchProfileEvent(payload);
      void silentRefreshProfile();
    });
  }, [churchId, applyChurchProfileEvent, silentRefreshProfile]);

  useEffect(() => {
    if (String(params.saved || "") !== "1") return;
    const nextName = String(params.savedName || profile.name || "Church profile");
    setSaveBanner(`${nextName} updated successfully`);
    const t = setTimeout(() => setSaveBanner(""), 2600);
    return () => clearTimeout(t);
  }, [params.saved, params.savedName, profile.name]);

  const role = String(effectiveAuthRole || "Member");
  const isMember = role === "Member";
  const isLeader = role === "Leader" || role === "Ministry_Leader";
  const isPastor = role === "Pastor";
  const isChurchAdmin = role === "Church_Admin";
  const isSystemAdmin = role === "System_Admin";

  const canSeeLeadershipOverview = isLeader || isPastor || isChurchAdmin || isSystemAdmin;
  const canSeeOfferings = isPastor || isChurchAdmin || isSystemAdmin;
  const canOpenMembers = !invitePreview;
  const canOpenMinistries = !invitePreview && canSeeLeadershipOverview;
  const canOpenOfferings = !invitePreview && canSeeOfferings;
  const canEditProfile = !invitePreview && (isPastor || isChurchAdmin || isSystemAdmin);
  const canUsePastorMediaControl = !invitePreview && (isPastor || isChurchAdmin || isSystemAdmin);

  function ministryInitial(name?: string) {
    return String(name || "M").trim().charAt(0).toUpperCase() || "M";
  }

  async function saveMediaAccessChanges() {
    if (!canUsePastorMediaControl) return;

    const selectedIds = new Set(
      mediaTargets.filter((m) => m.mediaAccess).slice(0, 3).map((m) => m.id)
    );

    setMediaTargetsLoading(true);
    try {
      await Promise.all(
        mediaTargets.map((m) =>
          apiPatch<any>(
            `/api/church/ministries?id=${encodeURIComponent(m.id)}`,
            { mediaAccess: selectedIds.has(m.id) },
            { headers: getKristoHeaders() }
          )
        )
      );

      setMediaTargets((prev) =>
        prev
          .map((m) => ({ ...m, mediaAccess: selectedIds.has(m.id) }))
          .sort((a, b) => Number(!!b.mediaAccess) - Number(!!a.mediaAccess) || a.name.localeCompare(b.name))
      );

      setMediaTargetsSaved(true);
      setSaveBanner("Media access saved");
      setMediaPickerOpen(false);
      setTimeout(() => setSaveBanner(""), 2200);
      await load({ silent: true });
    } finally {
      setMediaTargetsLoading(false);
    }
  }

  async function openPastorMediaPicker(mode: "manage" | "studio" = "studio") {
    if (!canUsePastorMediaControl) return;
    setMediaPickerMode(mode);
    setMediaPickerOpen(true);
    setMediaTargetsLoading(true);
    setMediaTargetsSaved(false);

    try {
      const j = await apiGet<any>("/api/church/ministries", {
        headers: getHeaders(),
      });

      const list = Array.isArray(j?.data) ? j.data : [];
      let used = 0;

      setMediaTargets(
        list
          .map((m: any) => {
            const wantsAccess = m?.mediaAccess === true;
            const allowed = wantsAccess && used < 3;
            if (allowed) used += 1;

            return {
              id: String(m?.id || ""),
              name: String(m?.name || "Ministry"),
              mediaAccess: allowed,
            };
          })
          .filter((m: MediaMinistryTarget) => Boolean(m.id))
          .sort((a: MediaMinistryTarget, b: MediaMinistryTarget) => Number(!!b.mediaAccess) - Number(!!a.mediaAccess) || a.name.localeCompare(b.name))
      );
    } catch {
      setMediaTargets([]);
    } finally {
      setMediaTargetsLoading(false);
    }
  }

  function toggleMediaAccess(target: MediaMinistryTarget) {
    if (!canUsePastorMediaControl || !target?.id) return;

    setMediaTargets((prev) => {
      const selectedCount = prev.filter((x) => x.mediaAccess).length;

      return prev
        .map((item) => {
          if (item.id !== target.id) return item;

          if (item.mediaAccess) {
            return { ...item, mediaAccess: false };
          }

          if (selectedCount >= 3) {
            return item;
          }

          return { ...item, mediaAccess: true };
        })
        .sort((a, b) => Number(!!b.mediaAccess) - Number(!!a.mediaAccess) || a.name.localeCompare(b.name));
    });

    setMediaTargetsSaved(false);
  }

  function openMediaStudio(target?: MediaMinistryTarget) {
    setMediaPickerOpen(false);
    router.push({
      pathname: "/more/media" as any,
      params: {
        source: "church-overview",
        mediaScope: target?.id ? "ministry" : "church",
        ministryId: target?.id || "",
        ministryName: target?.name || "",
      },
    } as any);
  }

  const roleLabel = invitePreview
    ? "Church Preview"
    : isChurchAdmin
    ? "Church Admin Overview"
    : isPastor
    ? "Pastor Overview"
    : isLeader
    ? "Leader Overview"
    : "Member Overview";

  const accessNote = isMember
    ? "Taarifa za msingi na notifications."
    : canSeeOfferings
    ? "Members, ministries, notifications na sadaka."
    : "Viongozi wanaona members, ministries, ministry members na notifications.";

  const cards = useMemo(() => {
    const memberCards = [
      {
        key: "members",
        label: "Active Members",
        value: stats.activeMembers,
        icon: "people-outline" as const,
        onPress: () => router.push("/church/members"),
      },

    ];

    const leaderOnlyCards = [
      {
        key: "ministries",
        label: "Ministries",
        value: stats.ministries,
        icon: "grid-outline" as const,
        onPress: () => {
          if (isPastor) router.push("/church/ministries" as any);
          else router.push("/more/ministries" as any);
        },
      },
      {
        key: "ministryMembers",
        label: "Ministry Members",
        value: stats.ministryMembers,
        icon: "person-add-outline" as const,
        onPress: () => {
          if (isPastor) router.push("/church/ministries" as any);
          else router.push("/more/ministries" as any);
        },
      },
    ];

    const offeringCards = canSeeOfferings
      ? [
        ]
      : [];

    if (invitePreview) return [...memberCards, ...leaderOnlyCards];
    if (isMember) return [...memberCards, ...leaderOnlyCards];
    if (canSeeLeadershipOverview) return [...memberCards, ...leaderOnlyCards, ...offeringCards];
    return memberCards;
  }, [stats, router, isMember, canSeeLeadershipOverview, canSeeOfferings, invitePreview]);

  return (
    <View style={[s.wrap, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
      <View style={s.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.h1}>Church Overview</Text>
          <Text style={s.p}>
            {roleLabel}
            {refreshing ? " • Refreshing..." : ""}
          </Text>
        </View>

        <Pressable onPress={() => load({ silent: true })} style={s.refreshBtn} hitSlop={10}>
          <Ionicons name="refresh" size={18} color="white" />
        </Pressable>
      </View>

      {invitePreview ? (
        <View style={s.successBanner}>
          <Ionicons name="eye-outline" size={16} color={GOLD} />
          <Text style={s.successBannerText}>
            {previewLimitReached
              ? "Preview limit reached • Accept invite to continue"
              : `Preview only • ${Math.max(0, 3 - previewCount)} view${Math.max(0, 3 - previewCount) === 1 ? "" : "s"} left`}
          </Text>

          <Pressable
            onPress={acceptPreviewInvite}
            style={{
              marginLeft: 10,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: "#D9B35F"
            }}
          >
            <Text style={{ color: "#0B0F17", fontWeight: "700", fontSize: 12 }}>
              {acceptingInvite ? "Accepting..." : "Accept"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!!saveBanner && (
        <View style={s.successBanner}>
          <Ionicons name="checkmark-circle" size={16} color={GOLD} />
          <Text style={s.successBannerText}>{saveBanner}</Text>
        </View>
      )}

      {loading || (invitePreview && !previewChecked) ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.p}>Loading overview...</Text>
        </View>
      ) : invitePreview && previewLimitReached ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Preview limit reached</Text>
          <Text style={s.errorText}>You have used your 3 free previews. Accept this invitation to continue viewing this church.</Text>

          <Pressable onPress={acceptPreviewInvite} style={[s.btn, s.btnGold]}>
            <Text style={[s.btnText, s.btnTextGold]}>
              {acceptingInvite ? "Accepting..." : "Accept Invitation"}
            </Text>
          </Pressable>
        </View>
      ) : err ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Failed to load</Text>
          <Text style={s.errorText}>{err}</Text>

          <Pressable onPress={() => load()} style={[s.btn, s.btnGold]}>
            <Text style={[s.btnText, s.btnTextGold]}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}>
          <View style={s.profileCard}>
            <View style={s.profileTop}>
              {profile.avatarUri ? (
                <Image
                  source={{ uri: avatarCacheBust(profile.avatarUri, profile.avatarUpdatedAt) }}
                  style={s.profileAvatar}
                  resizeMode="cover"
                />
              ) : (
                <View style={s.profileIcon}>
                  <Ionicons name="business-outline" size={22} color={GOLD} />
                </View>
              )}

              <View style={{ flex: 1 }}>
                <Text style={s.profileEyebrow}>Church Profile</Text>
                <Text style={s.profileChurch}>{profile.name || "Church Profile"}</Text>
              </View>

              {canEditProfile ? (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/church/edit" as any,
                      params: {
                        name: profile.name || "",
                        pastorName: profile.pastorName || "",
                        address: profile.address || "",
                        phone: profile.phone || "",
                      },
                    })
                  }
                  style={s.profileEditBtn}
                >
                  <Ionicons name="create-outline" size={16} color={GOLD} />
                </Pressable>
              ) : null}
            </View>

            <View style={s.profileInfoList}>
              <View style={s.profileInfoRow}>
                <Ionicons name="person-outline" size={15} color={GOLD} />
                <Text style={s.profileInfoLabel}>Pastor</Text>
                <Text style={s.profileInfoValue}>{profile.pastorName || "—"}</Text>
              </View>

              <View style={s.profileInfoRow}>
                <Ionicons name="location-outline" size={15} color={GOLD} />
                <Text style={s.profileInfoLabel}>Address</Text>
                <Text style={s.profileInfoValue}>{profile.address || "—"}</Text>
              </View>

              <View style={s.profileInfoRow}>
                <Ionicons name="call-outline" size={15} color={GOLD} />
                <Text style={s.profileInfoLabel}>Phone</Text>
                <Text style={s.profileInfoValue}>{profile.phone || "—"}</Text>
              </View>
            </View>
          </View>

          <View style={s.grid}>
            {cards.map((c) => {
              return (
                <Pressable
                  key={c.key}
                  disabled={invitePreview}
                  onPress={invitePreview ? undefined : c.onPress}
                  style={[s.statCard, invitePreview && { opacity: 0.92 }]}
                >
                  <View style={s.statIcon}>
                    <Ionicons name={c.icon} size={18} color={GOLD} />
                  </View>
                  <Text style={s.statValue}>{c.value}</Text>
                  <Text style={s.statLabel}>{c.label}</Text>
                </Pressable>
              );
            })}
            {!invitePreview ? (
            <Pressable
              onPress={() => {
                if (!canOpenMinistries) {
                  Alert.alert("Admin access", "Only pastor or church admin can create ministries. Ukipewa admin access utaweza kutumia sehemu hii.");
                  return;
                }
                router.push("/church/ministries/create" as any);
              }}
              style={[s.statCard, !canOpenMinistries && { opacity: 0.92 }]}
            >
              <View style={s.statIcon}>
                <Ionicons name="add-circle-outline" size={24} color={GOLD} />
              </View>
              <Text style={s.statValue}>+</Text>
              <Text style={s.statLabel}>Create Ministry</Text>
            </Pressable>
          ) : null}
        </View>

          {!invitePreview ? (
            <View style={[s.powerCard, !canUsePastorMediaControl && { opacity: 0.92 }]}>
              <View style={s.powerTop}>
                <View style={s.powerIcon}>
                  <Ionicons name="videocam" size={19} color="#0B0F17" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.powerTitle}>Ministry Media Control</Text>
                  <Text style={s.powerSub}>Choose ministries with media access, hosts, schedules, and live planning.</Text>
                </View>
              </View>

              <View style={s.powerActions}>
                <Pressable
                  onPress={() => {
                    if (!canUsePastorMediaControl) {
                      Alert.alert("Admin access", "Only pastor or church admin can manage ministry media access. Ukipewa admin access utaweza kutumia.");
                      return;
                    }
                    openPastorMediaPicker("manage");
                  }}
                  style={s.powerBtn}
                >
                  <Ionicons name="grid-outline" size={16} color={GOLD} />
                  <Text style={s.powerBtnText}>Ministries</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (!canUsePastorMediaControl) {
                      Alert.alert("Admin access", "Only pastor or church admin can open Media Studio controls. Ukipewa admin access utaweza kutumia.");
                      return;
                    }
                    openPastorMediaPicker("studio");
                  }}
                  style={[s.powerBtn, s.powerBtnGold]}
                >
                  <Ionicons name="radio-outline" size={16} color="#0B0F17" />
                  <Text style={s.powerBtnGoldText}>Media Studio</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          
        </ScrollView>
      )}

      <Modal visible={mediaPickerOpen} animationType="slide" onRequestClose={() => setMediaPickerOpen(false)}>
        <View style={[s.mediaFullScreen, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
          <View style={s.mediaFullHeader}>
            <Pressable onPress={() => setMediaPickerOpen(false)} style={s.mediaFullBackBtn}>
              <Ionicons name="chevron-back" size={22} color="white" />
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={s.mediaFullTitle}>
                {mediaPickerMode === "studio" ? "Choose Media Studio" : "Manage Media Access"}
              </Text>
              <Text style={s.mediaFullSub}>
                {mediaPickerMode === "studio"
                  ? `Church + ${Math.min(3, mediaTargets.filter((m) => m.mediaAccess).length)}/3 selected ministries`
                  : `Church + ${Math.min(3, mediaTargets.filter((m) => m.mediaAccess).length)}/3 selected ministries`}
              </Text>
            </View>

            {mediaPickerMode === "manage" ? (
              <Pressable onPress={saveMediaAccessChanges} style={s.mediaFullSaveBtn}>
                <Ionicons name={mediaTargetsSaved ? "checkmark-circle" : "save-outline"} size={16} color="#0B0F17" />
                <Text style={s.mediaFullSaveText}>{mediaTargetsSaved ? "Saved" : "Save"}</Text>
              </Pressable>
            ) : null}
          </View>

          {mediaPickerMode === "studio" ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.mediaFullList}>
              <Pressable onPress={() => openMediaStudio()} style={s.mediaStudioBigCard}>
                <View style={s.mediaAvatarGold}>
                  <Ionicons name="business-outline" size={22} color="#0B0F17" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.mediaChoiceTitle}>Church Live Control</Text>
                  <Text style={s.mediaChoiceSub}>Direct pastor go live</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
              </Pressable>

              {mediaTargets
                .filter((m) => m.mediaAccess)
                .slice(0, 3)
                .map((m) => (
                  <Pressable key={m.id} onPress={() => openMediaStudio(m)} style={s.mediaStudioBigCard}>
                    <View style={s.mediaAvatar}>
                      <Text style={s.mediaAvatarText}>{ministryInitial(m.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.mediaChoiceTitle}>{m.name}</Text>
                      <Text style={s.mediaChoiceSub}>Ministry media studio</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
                  </Pressable>
                ))}
            </ScrollView>
          ) : (
            <>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.mediaFullList}>
                {mediaTargetsLoading ? (
                  <Text style={s.mediaFullSub}>Loading ministries…</Text>
                ) : (
                  mediaTargets
                    .slice()
                    .sort((a, b) => Number(b.mediaAccess) - Number(a.mediaAccess) || a.name.localeCompare(b.name))
                    .map((m) => {
                      const selectedCount = mediaTargets.filter((x) => x.mediaAccess).length;
                      const lockedAdd = !m.mediaAccess && selectedCount >= 3;

                      return (
                        <View key={m.id} style={[s.mediaManageRow, m.mediaAccess && s.mediaManageRowOn]}>
                          <View style={m.mediaAccess ? s.mediaAvatarGold : s.mediaAvatar}>
                            <Text style={[s.mediaAvatarText, m.mediaAccess && s.mediaAvatarTextGold]}>
                              {ministryInitial(m.name)}
                            </Text>
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={s.mediaChoiceTitle}>{m.name}</Text>
                            <Text style={s.mediaChoiceSub}>
                              {m.mediaAccess ? "Media access ON" : lockedAdd ? "Limit reached: remove one first" : "Media access OFF"}
                            </Text>
                          </View>

                          <Pressable
                            onPress={() => toggleMediaAccess(m)}
                            style={[s.mediaSwitch, m.mediaAccess && s.mediaSwitchOn, lockedAdd && s.mediaSwitchDisabled]}
                          >
                            <View style={[s.mediaSwitchKnob, m.mediaAccess && s.mediaSwitchKnobOn]} />
                          </Pressable>
                        </View>
                      );
                    })
                )}
              </ScrollView>

              <View style={s.mediaRuleCard}>
                <Ionicons name="lock-closed-outline" size={18} color={GOLD} />
                <View style={{ flex: 1 }}>
                  <Text style={s.mediaRuleTitle}>30-day ministry access rule</Text>
                  <Text style={s.mediaRuleText}>
                    You can change or remove a ministry from media access after 30 days. Next change date will show here after saving.
                  </Text>
                  <Text style={s.mediaRuleDate}>Next allowed change: after 30 days</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create<any>({
  profileCard:{
    borderRadius:22,
    padding:18,
    marginBottom:18,
    borderWidth:1,
    borderColor:"rgba(217,179,95,0.32)",
    backgroundColor:"rgba(217,179,95,0.08)"
  },

  profileTop:{
    flexDirection:"row",
    alignItems:"center",
    gap:14,
    marginBottom:14
  },

  profileAvatar:{
    width:54,
    height:54,
    borderRadius:18,
    borderWidth:1,
    borderColor:"rgba(217,179,95,0.32)"
  },

  profileIcon:{
    width:54,
    height:54,
    borderRadius:18,
    alignItems:"center",
    justifyContent:"center",
    backgroundColor:"rgba(255,255,255,0.06)",
    borderWidth:1,
    borderColor:"rgba(217,179,95,0.22)"
  },

  profileEditBtn:{
    width:36,
    height:36,
    borderRadius:12,
    alignItems:"center",
    justifyContent:"center",
    backgroundColor:"rgba(255,255,255,0.05)",
    borderWidth:1,
    borderColor:"rgba(217,179,95,0.20)"
  },

  profileEyebrow:{
    color:"rgba(255,255,255,0.58)",
    fontSize:12,
    fontWeight:"800",
    marginBottom:4,
    textTransform:"uppercase",
    letterSpacing:0.8
  },

  profileChurch:{
    color:"white",
    fontSize:22,
    fontWeight:"900"
  },

  profileInfoList:{
    gap:10
  },

  profileInfoRow:{
    flexDirection:"row",
    alignItems:"center"
  },

  profileInfoLabel:{
    width:62,
    marginLeft:8,
    color:"rgba(255,255,255,0.62)",
    fontSize:12,
    fontWeight:"800"
  },

  profileInfoValue:{
    flex:1,
    color:"rgba(255,255,255,0.90)",
    fontSize:13,
    fontWeight:"700"
  },

  wrap: { flex: 1, backgroundColor: VIP_BG, paddingHorizontal: 16 },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  h1: { color: "white", fontSize: 26, fontWeight: "900", letterSpacing: 0.2 },
  p: { color: MUTED, marginTop: 6, fontSize: 13, lineHeight: 18 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },

  heroCard: {
    borderRadius: 18,
    padding: 12,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  heroTitle: { color: "white", fontSize: 16, fontWeight: "900" },
  heroSub: { color: MUTED, marginTop: 3, fontSize: 12, lineHeight: 16, fontWeight: "700" },

  errorCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(120,20,20,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,90,90,0.22)",
  },
  errorTitle: { color: "white", fontSize: 15, fontWeight: "900" },
  errorText: { color: "rgba(255,255,255,0.78)", marginTop: 6, fontSize: 13, lineHeight: 18 },

  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  successBannerText: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
    marginBottom: 14,
  },
  statCard: {
    width: "48%",
    minHeight: 124,
    borderRadius: 18,
    padding: 14,
    marginBottom: 0,
    backgroundColor: "rgba(12,20,36,0.95)",
    borderWidth: 1,
    borderColor: "rgba(60,120,255,0.20)",
  },
  statCardGold: {
    width: "100%",
    minHeight: 96,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    marginBottom: 14,
  },
  statIconGold: {
    backgroundColor: "rgba(217,179,95,0.16)",
  },
  statValue: { color: "white", fontSize: 24, fontWeight: "900" },
  statValueGold: { color: GOLD },
  statLabel: { color: MUTED, marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: "700" },

  powerCard: {
    marginTop: 14,
    marginBottom: 18,
    borderRadius: 26,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: "rgba(217,179,95,0.075)",
  },
  powerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  powerIcon: {
    width: 46,
    height: 46,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  powerTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
  },
  powerSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  powerActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 15,
  },
  powerBtn: {
    flex: 1,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  powerBtnGold: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  powerBtnText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 12,
  },
  powerBtnGoldText: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 12,
  },


  mediaModalShade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "center",
    padding: 18,
  },
  mediaModalCard: {
    width: "90%",
    height: "74%",
    borderRadius: 30,
    padding: 18,
    backgroundColor: "#0B111D",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.48)",
    overflow: "hidden",
  },
  mediaModalTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  mediaModalTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },
  mediaModalSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
  },
  mediaModalClose: {
    width: 38,
    height: 38,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  mediaChoice: {
    minHeight: 66,
    borderRadius: 19,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  mediaChoiceTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  mediaChoiceSub: {
    marginTop: 2,
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "700",
  },


  mediaModalList: {
    flex: 1,
    marginTop: 10,
    marginBottom: 2,
  },

  mediaFooter: {
    paddingTop: 10,
    backgroundColor: "#0B111D",
  },

  mediaSaveBtn: {
    height: 54,
    borderRadius: 19,
    marginTop: 12,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  mediaSaveText: {
    color: "#0B0F17",
    fontSize: 14,
    fontWeight: "900",
  },
  createMinistryCard: {
    marginTop: 18,
    minHeight: 118,
    borderRadius: 30,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1.4,
    borderColor: "rgba(217,179,95,0.42)",
  },
  createMinistryIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  },
  createMinistryTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  createMinistrySub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "800",
  },

  mediaAccessToggleDisabled: {
    opacity: 0.45,
  },


  mediaFullScreen: {
    flex: 1,
    backgroundColor: "#070B14",
    paddingHorizontal: 18,
  },
  mediaFullHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  mediaFullBackBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  mediaFullTitle: {
    color: "white",
    fontSize: 25,
    fontWeight: "900",
  },
  mediaFullSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "800",
  },
  mediaFullSaveBtn: {
    height: 44,
    borderRadius: 18,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: GOLD,
  },
  mediaFullSaveText: {
    color: "#0B0F17",
    fontSize: 12,
    fontWeight: "900",
  },
  mediaFullList: {
    paddingTop: 4,
    paddingBottom: 18,
    gap: 10,
  },
  mediaManageRow: {
    minHeight: 82,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  mediaManageRowOn: {
    backgroundColor: "rgba(217,179,95,0.105)",
    borderColor: "rgba(217,179,95,0.42)",
  },
  mediaAvatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.25)",
  },
  mediaAvatarGold: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  mediaAvatarText: {
    color: GOLD,
    fontSize: 18,
    fontWeight: "900",
  },
  mediaAvatarTextGold: {
    color: "#0B0F17",
  },
  mediaSwitch: {
    width: 58,
    height: 34,
    borderRadius: 999,
    padding: 4,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  mediaSwitchOn: {
    backgroundColor: GOLD,
    borderColor: GOLD,
    alignItems: "flex-end",
  },
  mediaSwitchDisabled: {
    opacity: 0.42,
  },
  mediaSwitchKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  mediaSwitchKnobOn: {
    backgroundColor: "#0B0F17",
  },
  mediaStudioBigCard: {
    minHeight: 84,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  mediaRuleCard: {
    marginTop: 8,
    borderRadius: 22,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  mediaRuleTitle: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  mediaRuleText: {
    marginTop: 3,
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  mediaRuleDate: {
    marginTop: 7,
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
  },

  actionsWrap: { gap: 10, marginTop: 2 },
  btn: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  btnGold: {
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  btnGoldSoft: {
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  btnText: { color: "white", fontSize: 14, fontWeight: "800", letterSpacing: 0.2, textAlign: "center" },
  btnTextGold: { color: GOLD },

});
