import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Dimensions,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { Stack, useRouter, router, useLocalSearchParams } from "expo-router";
import { buildKristoRequestHeaders, getKristoAuth } from "@/src/lib/kristoHeaders";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { feedList, subscribe, feedToggleLike, feedToggleSave, type FeedItem } from "@/src/lib/churchFeedStore";
import { useFocusedPolling } from "@/src/lib/useFocusedPolling";

const S = { pad: 16 };

const C = {
  bg: "#0B0F17",
  glass: "rgba(255,255,255,0.06)",
  glass2: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.14)",
  gold: "rgba(217,179,95,0.95)",
  text: {
    primary: "rgba(255,255,255,0.96)",
    secondary: "rgba(255,255,255,0.72)",
    muted: "rgba(255,255,255,0.52)",
  },
};

function kindTheme(kind?: string) {
  if (kind === "prayer_request") {
    return {
      accent: "rgba(255,120,120,0.96)",
      softBg: "rgba(255,120,120,0.09)",
      softBorder: "rgba(255,120,120,0.30)",
      avatarBg: "rgba(255,120,120,0.16)",
      avatarBorder: "rgba(255,120,120,0.42)",
      pillBg: "rgba(255,120,120,0.12)",
      pillBorder: "rgba(255,120,120,0.28)",
      title: "rgba(255,185,185,0.99)",
      label: "Prayer Request",
      messageLabel: "Prayer request",
    };
  }

  if (kind === "announcement") {
    return {
      accent: "rgba(217,179,95,0.95)",
      softBg: "rgba(217,179,95,0.07)",
      softBorder: "rgba(217,179,95,0.26)",
      avatarBg: "rgba(217,179,95,0.14)",
      avatarBorder: "rgba(217,179,95,0.38)",
      pillBg: "rgba(217,179,95,0.10)",
      pillBorder: "rgba(217,179,95,0.24)",
      title: "rgba(235,195,96,0.98)",
      label: "Announcement",
      messageLabel: "Announcement message",
    };
  }

  if (kind === "testimony") {
    return {
      accent: "rgba(0,145,255,0.96)",
      softBg: "rgba(0,145,255,0.07)",
      softBorder: "rgba(0,145,255,0.28)",
      avatarBg: "rgba(0,145,255,0.14)",
      avatarBorder: "rgba(0,145,255,0.38)",
      pillBg: "rgba(0,145,255,0.10)",
      pillBorder: "rgba(0,145,255,0.24)",
      title: "rgba(80,180,255,0.98)",
      label: "Testimony",
      messageLabel: "Testimony message",
    };
  }

  if (kind === "counsel") {
    return {
      accent: "rgba(80,220,180,0.96)",
      softBg: "rgba(80,220,180,0.07)",
      softBorder: "rgba(80,220,180,0.28)",
      avatarBg: "rgba(80,220,180,0.14)",
      avatarBorder: "rgba(80,220,180,0.36)",
      pillBg: "rgba(80,220,180,0.10)",
      pillBorder: "rgba(80,220,180,0.24)",
      title: "rgba(120,235,200,0.98)",
      label: "Counsel",
      messageLabel: "Counsel message",
    };
  }

  return {
    accent: "rgba(180,140,255,0.95)",
    softBg: "rgba(180,140,255,0.07)",
    softBorder: "rgba(180,140,255,0.24)",
    avatarBg: "rgba(180,140,255,0.14)",
    avatarBorder: "rgba(180,140,255,0.34)",
    pillBg: "rgba(180,140,255,0.10)",
    pillBorder: "rgba(180,140,255,0.22)",
    title: "rgba(210,190,255,0.98)",
    label: "Post",
    messageLabel: "Post message",
  };
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "—";
  }
}

function fmtDate(iso?: string) {
  try {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

const CARD_A_PREVIEW_CHARS = 132;

function buildInlinePreview(text: string, maxChars = CARD_A_PREVIEW_CHARS) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\.\.\s*Read more\s*$/i, "")
    .trim();

  if (!clean) return { preview: "", previewText: "", truncated: false };

  const firstSentenceEnd = clean.search(/[.!?](\s|$)/);
  if (firstSentenceEnd > 36 && firstSentenceEnd <= maxChars - 18) {
    const firstSentence = clean.slice(0, firstSentenceEnd + 1).trim();
    return {
      preview: firstSentence,
      previewText: `${firstSentence} ... Read more`,
      truncated: clean.length > firstSentence.length,
    };
  }

  if (clean.length <= maxChars) {
    return { preview: clean, previewText: clean, truncated: false };
  }

  let cut = clean.slice(0, maxChars).trimEnd();

  const punctuationCut = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf(", "),
    cut.lastIndexOf("; "),
    cut.lastIndexOf(": ")
  );

  const wordCut = cut.lastIndexOf(" ");
  const safeEdge = Math.floor(maxChars * 0.62);

  if (punctuationCut > safeEdge) {
    cut = cut.slice(0, punctuationCut + 1).trimEnd();
  } else if (wordCut > safeEdge) {
    cut = cut.slice(0, wordCut).trimEnd();
  }

  cut = cut.replace(/[.,;:!?-]+$/g, "").trimEnd();

  const words = cut.split(" ").filter(Boolean);
  if (words.length > 8) {
    const tail = words.slice(-4).join(" ");
    const head = words.slice(0, -4).join(" ");
    if (head.includes(tail)) {
      cut = head.trimEnd();
    }
  }

  const previewText = `${cut} ... Read more`;
  return { preview: cut, previewText, truncated: true };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function imageContentPosition(item: FeedItem) {
  const meta = (item as any)?.mediaMeta || {};
  if (typeof meta.focusX === "number" && typeof meta.focusY === "number") {
    let x = clamp01(Number(meta.focusX));
    let y = clamp01(Number(meta.focusY));

    const leftSpace = Number(meta.leftSpace ?? 0);
    const rightSpace = Number(meta.rightSpace ?? 0);
    const sideBias = Number(meta.sideBias ?? 0);
    const sceneType = String(meta.sceneType || "");
    const narrowContent = Boolean(meta.narrowContent);
    const faceCenterY = Number(meta.faceCenterY ?? 0.36);
    const frameType = String(meta.frameType || "");

    // preserve face first
    if (faceCenterY > 0) {
      const preferredFaceY = clamp01(faceCenterY + 0.10);
      y = Math.min(y, preferredFaceY);
    }

    // full body / seated / desk: shusha kidogo ili mwili uonekane natural zaidi
    if (["full_body", "seated", "desk"].includes(frameType)) {
      y = clamp01(Math.max(y, faceCenterY + 0.14));
    } else if (meta?.isTallPortrait) {
      y = clamp01(y - 0.03);
    } else if (meta?.isPortrait) {
      y = clamp01(y - 0.015);
    }

    // shift horizontally toward subject kama kuna dead space pembeni
    if (leftSpace > rightSpace) {
      x = clamp01(x + Math.min(0.14, (leftSpace - rightSpace) * 0.75 + sideBias));
    } else if (rightSpace > leftSpace) {
      x = clamp01(x - Math.min(0.14, (rightSpace - leftSpace) * 0.75 + sideBias));
    }

    // narrow screenshot/group: keep face visible, usishushe sana
    if (sceneType === "narrow_group_scene" || narrowContent) {
      const avgSide = (leftSpace + rightSpace) / 2;
      if (avgSide >= 0.16) {
        x = clamp01(0.5 + (x - 0.5) * 0.68);
      }
      y = Math.min(y, clamp01(faceCenterY + 0.12));
    }

    return {
      left: `${Math.round(x * 100)}%`,
      top: `${Math.round(y * 100)}%`,
    } as any;
  }

  const legacyTop = String((item as any)?.mediaFocus || "") === "top";
  return legacyTop ? "top" : "center";
}

function imageZoomScale(item: FeedItem) {
  const meta = (item as any)?.mediaMeta || {};
  let z = Number(meta.zoomScale || 1);

  const sceneType = String(meta.sceneType || "");
  const frameType = String(meta.frameType || "");
  const leftSpace = Number(meta.leftSpace ?? 0);
  const rightSpace = Number(meta.rightSpace ?? 0);
  const avgSide = (leftSpace + rightSpace) / 2;
  const faceCenterY = Number(meta.faceCenterY ?? 0.36);

  // preserve faces: narrow/group screenshot should zoom, but softly
  if (sceneType === "narrow_group_scene" || frameType === "narrow_group") {
    z = Math.max(z, 1.38);
  }

  if (avgSide >= 0.18) {
    z = Math.max(z, 1.52);
  }
  if (avgSide >= 0.24) {
    z = Math.max(z, 1.66);
  }

  // if face already high in frame, do not overzoom
  if (faceCenterY <= 0.30) {
    z = Math.min(z, 1.46);
  }

  if (!Number.isFinite(z)) return 1;
  return Math.max(1, Math.min(1.72, z));
}

function mediaWrapVariant(item: FeedItem) {
  const frameType = String(((item as any)?.mediaMeta?.frameType) || "");
  if (frameType === "desk") return styles.mediaWrapDesk;
  if (frameType === "seated") return styles.mediaWrapSeated;
  if (frameType === "full_body") return styles.mediaWrapFullBody;
  if (frameType === "narrow_group") return styles.mediaWrapNarrowGroup;
  if (frameType === "tall") return styles.mediaWrapTall;
  if (frameType === "portrait") return styles.mediaWrapPortrait;
  return null;
}


function useSideFillBackground(item: FeedItem) {
  return false;
}
function imageContentFit(item: FeedItem) {
  return useSideFillBackground(item) ? "contain" : "cover";
}

function backgroundContentPosition(item: FeedItem) {
  const pos = imageContentPosition(item);
  return pos || "center";
}

function foregroundScale(item: FeedItem) {
  const meta = (item as any)?.mediaMeta || {};

  const leftSpace = Number(meta.leftSpace ?? 0);
  const rightSpace = Number(meta.rightSpace ?? 0);
  const avgSide = (leftSpace + rightSpace) / 2;

  const faceCenterY = Number(meta.faceCenterY ?? 0.36);
  const frameType = String(meta.frameType || "");
  const narrowContent = Boolean(meta.narrowContent);
  const usingBg = useSideFillBackground(item);

  let z = usingBg ? 1.02 : imageZoomScale(item);

  // natural full-body / seated / desk: hifadhi mwili wote, usizoom sana
  if (["full_body", "seated", "desk"].includes(frameType)) {
    z = Math.min(z, 1.03);
    if (avgSide >= 0.18) {
      z = Math.min(z, 1.02);
    }
  }

  // portrait ya kawaida: ruhusu zoom kidogo zaidi kuliko full body
  if (["portrait", "tall"].includes(frameType) && !narrowContent) {
    if (avgSide < 0.16) {
      z = Math.max(z, 1.05);
    }
    if (faceCenterY >= 0.30 && faceCenterY <= 0.41) {
      z = Math.max(z, 1.08);
    }
  }

  // screenshot-like / narrow content: usizidishe foreground
  if (narrowContent) {
    z = Math.min(z, 1.04);
  }

  if (usingBg && avgSide >= 0.26) {
    z = Math.max(z, 1.03);
  }

  return Math.max(1, Math.min(1.10, z));
}

function mediaVariant(item: FeedItem) {
  const frameType = String(((item as any)?.mediaMeta?.frameType) || "");
  if (frameType === "desk") return styles.mediaDesk;
  if (frameType === "seated") return styles.mediaSeated;
  if (frameType === "full_body") return styles.mediaFullBody;
  if (frameType === "narrow_group") return styles.mediaNarrowGroup;
  if (frameType === "tall") return styles.mediaTall;
  if (frameType === "portrait") return styles.mediaPortrait;
  return null;
}

function initialOf(v?: string) {
  return String(v || "U").trim().charAt(0).toUpperCase() || "U";
}

function nameOfUserId(userId?: string) {
  const id = String(userId || "").trim();
  if (!id) return "Member";
  return id;
}

function toTitleCaseWords(v?: string) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

type OverviewStats = {
  activeMembers: number;
  ministries: number;
  ministryMembers: number;
  unreadNotifications: number;
};

type ChurchProfile = {
  id?: string;
  name?: string;
};

type ApiComment = {
  id: string;
  activeChurchId: string;
  postId: string;
  parentCommentId?: string;
  text: string;
  createdAt: string;
  createdBy: string;
  replies?: ApiComment[];
};

type ApiDetail = {
  item: {
    id: string;
    activeChurchId: string;
    type: "post" | "announcement" | "video";
    title?: string;
    text?: string;
    videoUrl?: string;
    createdAt: string;
    createdBy: string;
    commentCount?: number;
    replyCount?: number;
    totalDiscussionCount?: number;
  };
  comments: ApiComment[];
};

export default function ChurchTabFeed() {
  const router = useRouter();
const goOverview = () => router.push("/church/overview");
  const goMembers = () => router.push("/church/members");
  const goNotifications = () => router.push("/more/notifications");
  const goCreateChurch = () => router.push("/church/create" as any);
  const goJoinChurch = () => router.push("/church/join" as any);

  const auth = getKristoAuth() as any;
  const churchId = String(auth?.churchId || auth?.activeChurchId || "");
  const params = useLocalSearchParams();
  const activeChurchId = String(params.churchId || churchId || "").trim();
  const hasChurch = Boolean(activeChurchId);
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  const effectiveAuthUserId = String(auth?.userId || "");
  const effectiveAuthRole = String(auth?.role || "Member");

  const [tick, setTick] = useState(0);
  const [profile, setProfile] = useState<ChurchProfile>({ id: activeChurchId, name: "Church" });
  const [stats, setStats] = useState<OverviewStats>({
    activeMembers: 0,
    ministries: 0,
    ministryMembers: 0,
    unreadNotifications: 0,
  });
  const [loadingProfile, setLoadingProfile] = useState(true);

  const loadChurchTabData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (!base || !activeChurchId || !effectiveAuthUserId || !hasChurch) return;

      if (!silent) setLoadingProfile(true);

      const headers = buildKristoRequestHeaders(
        "/api/church/overview",
        {
          userId: effectiveAuthUserId,
          role: effectiveAuthRole as any,
          churchId: activeChurchId,
        },
        { accept: "application/json" },
        "ChurchTab"
      );

      try {
        const [overviewRes, membersRes, requestsRes] = await Promise.all([
          fetch(`${base}/api/church/overview`, { headers }),
          fetch(`${base}/api/church/members`, { headers }),
          fetch(`${base}/api/church/join-requests`, { headers }),
        ]);

        const overviewJson = await overviewRes.json().catch(() => ({}));
        const membersJson = await membersRes.json().catch(() => ({}));
        const requestsJson = await requestsRes.json().catch(() => ({}));

        let nextActiveMembers: number | null = null;
        let nextRequestCount: number | null = null;

        if (membersRes.ok && membersJson?.ok) {
          const rows = Array.isArray(membersJson?.data)
            ? membersJson.data
            : Array.isArray(membersJson?.items)
              ? membersJson.items
              : [];
          nextActiveMembers = rows.filter(
            (x: any) => String(x?.status || x?.membershipStatus || "active").toLowerCase() === "active"
          ).length;
        }

        if (requestsRes.ok && requestsJson?.ok) {
          const rows = Array.isArray(requestsJson?.data)
            ? requestsJson.data
            : Array.isArray(requestsJson?.items)
              ? requestsJson.items
              : [];
          nextRequestCount = rows.length;
        }

        if (overviewRes.ok && overviewJson?.ok) {
          const p = overviewJson?.data?.profile || {};
          const st = overviewJson?.data?.stats || {};
          const nextProfile = {
            id: String(p?.id || activeChurchId || ""),
            name: String(p?.name || "Church"),
          };
          const nextStats = {
            activeMembers: nextActiveMembers ?? Number(st?.activeMembers || 0),
            ministries: Number(st?.ministries || 0),
            ministryMembers: Number(st?.ministryMembers || 0),
            unreadNotifications: Number(st?.unreadNotifications || 0),
          };

          setProfile((prev) =>
            prev.id === nextProfile.id && prev.name === nextProfile.name ? prev : nextProfile
          );
          setStats((prev) =>
            prev.activeMembers === nextStats.activeMembers &&
            prev.ministries === nextStats.ministries &&
            prev.ministryMembers === nextStats.ministryMembers &&
            prev.unreadNotifications === nextStats.unreadNotifications
              ? prev
              : nextStats
          );
        }

        if (silent) {
          console.log("[ChurchTab] silent refresh", {
            members: nextActiveMembers,
            requests: nextRequestCount,
          });
        }
      } finally {
        if (!silent) setLoadingProfile(false);
      }
    },
    [base, activeChurchId, effectiveAuthRole, effectiveAuthUserId, hasChurch]
  );

  useEffect(() => {
    void loadChurchTabData({ silent: false });
  }, [loadChurchTabData]);

  useFocusedPolling(
    "ChurchTab",
    async () => {
      await loadChurchTabData({ silent: true });
    },
    2500,
    hasChurch
  );

  useEffect(() => {
    return subscribe(() => setTick((t) => t + 1));
  }, []);

  const insets = useSafeAreaInsets();
  const data = useMemo(() => feedList(), [tick]);
  const [truncatedMap, setTruncatedMap] = useState<Record<string, boolean>>({});

  const setItemTruncated = useCallback((id: string, value: boolean) => {
    setTruncatedMap((prev) => {
      if (prev[id] === value) return prev;
      return { ...prev, [id]: value };
    });
  }, []);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [followedActors, setFollowedActors] = useState<Record<string, boolean>>({});

  const actorFollowKey = useCallback((item: FeedItem) => {
    const raw =
      (item as any)?.actorId ??
      (item as any)?.authorId ??
      (item as any)?.userId ??
      item.id;

    return String(raw || item.id).trim().toLowerCase();
  }, []);

  const isActorFollowed = useCallback((item: FeedItem) => {
    return !!followedActors[actorFollowKey(item)];
  }, [followedActors, actorFollowKey]);

  const toggleActorFollow = useCallback((item: FeedItem) => {
    const key = actorFollowKey(item);
    setFollowedActors((prev) => ({ ...prev, [key]: !prev[key] }));
  }, [actorFollowKey]);
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openPostDetail = (id: string) => {
    router.push((`/church/post/${id}`) as any);
  };

  const openReadMore = (id: string) => {
    router.push((`/church/post/read/${id}`) as any);
  };

  const profileSlideX = React.useRef(new Animated.Value(SCREEN_WIDTH + 40)).current;
  const profileOffRight = SCREEN_WIDTH + 40;
  const profileOffLeft = -(SCREEN_WIDTH + 48);
  const profileManualMode = React.useRef<"open" | "closed" | null>(null);
  const profileManualReturnTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const openProfileNow = useCallback(() => {
    profileManualMode.current = "open";
    profileSlideX.stopAnimation();
    Animated.timing(profileSlideX, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [profileSlideX]);

  const closeProfileNow = useCallback((toLeft = true) => {
    profileManualMode.current = "closed";

    if (profileManualReturnTimer.current) {
      clearTimeout(profileManualReturnTimer.current);
      profileManualReturnTimer.current = null;
    }

    profileSlideX.stopAnimation();
    Animated.timing(profileSlideX, {
      toValue: toLeft ? profileOffLeft : profileOffRight,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      profileManualReturnTimer.current = setTimeout(() => {
        profileManualMode.current = null;
        profileManualReturnTimer.current = null;
      }, 60000);
    });
  }, [profileOffLeft, profileOffRight, profileSlideX]);

  const clearProfileManualMode = useCallback(() => {
    profileManualMode.current = null;
  }, []);

  const profilePanResponder = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) {
          const next = Math.max(profileOffLeft, Math.min(0, g.dx));
          profileSlideX.setValue(next);
        } else if (g.dx > 0) {
          const next = Math.min(profileOffRight, Math.max(0, g.dx));
          profileSlideX.setValue(next);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx <= -50) {
          closeProfileNow(true);
          return;
        }
        if (g.dx >= 50) {
          closeProfileNow(false);
          return;
        }

        openProfileNow();
      },
      onPanResponderTerminate: () => {
        profileSlideX.stopAnimation((v: number) => {
          if (v < profileOffLeft / 2) {
            closeProfileNow(true);
          } else {
            openProfileNow();
          }
        });
      },
    })
  ).current;

  useEffect(() => {
    let dead = false;

    const run = (fromRight: boolean) => {
      if (dead) return;

      if (profileManualMode.current === "open") {
        profileSlideX.setValue(0);
        setTimeout(() => {
          if (!dead) run(fromRight);
        }, 6000);
        return;
      }

      if (profileManualMode.current === "closed") {
        profileSlideX.setValue(fromRight ? profileOffRight : profileOffLeft);
        setTimeout(() => {
          if (!dead) run(fromRight);
        }, 6000);
        return;
      }

      const startX = fromRight ? profileOffRight : profileOffLeft;
      const exitX = fromRight ? profileOffLeft : profileOffRight;

      profileSlideX.setValue(startX);

      Animated.sequence([
        Animated.timing(profileSlideX, {
          toValue: 0,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(30000),
        Animated.timing(profileSlideX, {
          toValue: exitX,
          duration: 700,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(60000),
      ]).start(({ finished }) => {
        if (!finished || dead) return;
        run(!fromRight);
      });
    };

    run(true);

    return () => {
      dead = true;
      profileSlideX.stopAnimation();
      if (profileManualReturnTimer.current) {
        clearTimeout(profileManualReturnTimer.current);
        profileManualReturnTimer.current = null;
      }
    };
  }, [profileOffLeft, profileOffRight, profileSlideX]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Church", headerShown: false }} />
      <View style={styles.wrap}>
        <Animated.View
          {...profilePanResponder.panHandlers}
          style={[
            styles.stickyProfileWrap,
            { transform: [{ translateX: profileSlideX }] },
          ]}
        >
          <View style={styles.empty}>
            <View style={styles.profileGlow} />

            <View style={styles.profileRow}>
              <View style={styles.profileLeft}>
                <View style={styles.churchAvatarOuter}>
                  <View style={styles.churchAvatar}>
                    {loadingProfile ? (
                      <ActivityIndicator size="small" color={C.gold} />
                    ) : (
                      <Text style={styles.churchAvatarText}>
                        {String(profile?.name || "C").trim().charAt(0).toUpperCase() || "C"}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.profileTextWrap}>
                  <Text style={styles.profileEyebrow}>Church Profile</Text>
                  <Text style={styles.churchName} numberOfLines={1}>
                    {profile?.name || "Church"}
                  </Text>
                  <Text style={styles.churchMeta} numberOfLines={1}>
                    ID: {profile?.id || activeChurchId || "—"}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={goOverview}
                style={[styles.profileOverviewBtn, styles.profileOverviewBtnGold]}
              >
                <Text style={[styles.profileOverviewBtnText, styles.profileOverviewBtnTextGold]}>
                  Overview
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {!hasChurch ? (
          <View style={styles.noChurchGate}>
            <View style={styles.noChurchGlow} />
            <View style={styles.noChurchIcon}>
              <Ionicons name="business-outline" size={30} color={C.gold} />
            </View>

            <Text style={styles.noChurchTitle}>Start your church journey</Text>
            <Text style={styles.noChurchSub}>
              Create a church or join your church using an invitation. Your church feed will open after membership is active.
            </Text>

            <View style={styles.noChurchActions}>
              <Pressable onPress={goCreateChurch} style={styles.noChurchPrimary}>
                <Ionicons name="add-circle-outline" size={18} color="#0B0F17" />
                <Text style={styles.noChurchPrimaryText}>Create Church</Text>
              </Pressable>

              <Pressable onPress={goJoinChurch} style={styles.noChurchSecondary}>
                <Ionicons name="enter-outline" size={18} color={C.gold} />
                <Text style={styles.noChurchSecondaryText}>Request to Join</Text>
              </Pressable>
            </View>
          </View>
        ) : (
        <FlatList
          data={data}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingTop: 0, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
          showsVerticalScrollIndicator={false}
          bounces={false}
          decelerationRate="fast"
          snapToAlignment="start"
          snapToInterval={CHURCH_FEED_SNAP}
          disableIntervalMomentum
          renderItem={({ item }) => (
            <View style={[styles.snapItem, !item.mediaUri && styles.snapItemCentered]}>
              <FeedCard
                item={item}
                base={base}
                activeChurchId={activeChurchId}
                effectiveAuthUserId={effectiveAuthUserId}
                effectiveAuthRole={effectiveAuthRole}
                expanded={!!expanded[item.id]}
                isTruncated={!!truncatedMap[item.id]}
                following={isActorFollowed(item)}
                onToggleFollow={() => toggleActorFollow(item)}
                onToggleReadMore={() => openReadMore(String(item.id))}
                onOpenDetail={() => openPostDetail(String(item.id))}
                onBodyLayout={(isCut) => setItemTruncated(String(item.id), isCut)}
              />
            </View>
          )}
        />
        )}
      </View>
    </SafeAreaView>
  );
}

function FeedCard({
  item,
  base,
  activeChurchId,
  effectiveAuthUserId,
  effectiveAuthRole,
  expanded,
  isTruncated,
  following,
  onToggleFollow,
  onToggleReadMore,
  onOpenDetail,
  onBodyLayout,
}: {
  item: FeedItem;
  base: string;
  activeChurchId: string;
  effectiveAuthUserId: string;
  effectiveAuthRole: string;
  expanded?: boolean;
  isTruncated?: boolean;
  following: boolean;
  onToggleFollow: () => void;
  onToggleReadMore: () => void;
  onOpenDetail: () => void;
  onBodyLayout: (isTruncated: boolean) => void;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [posting, setPosting] = useState(false);
  const [detail, setDetail] = useState<ApiDetail | null>(null);
  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState<ApiComment | null>(null);

  const loadComments = useCallback(async () => {
    try {
      if (!base || !item.id || !activeChurchId || !effectiveAuthUserId) return;
      setLoadingComments(true);

      const r = await fetch(`${base}/api/church/feed?id=${encodeURIComponent(String(item.id))}`, {
        headers: {
          accept: "application/json",
          "x-kristo-user-id": effectiveAuthUserId,
          "x-kristo-role": effectiveAuthRole,
          "x-kristo-church-id": activeChurchId,
        },
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setDetail(null);
        return;
      }

      setDetail(j.data as ApiDetail);
    } finally {
      setLoadingComments(false);
    }
  }, [base, activeChurchId, effectiveAuthRole, effectiveAuthUserId, item.id]);

  const toggleComments = async () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next) {
      await loadComments();
    } else {
      setReplyTo(null);
      setComposer("");
    }
  };

  const submitCommentOrReply = async () => {
    const text = String(composer || "").trim();
if (!text) return;
    if (!base || !item.id || !activeChurchId || !effectiveAuthUserId) return;

    try {
      setPosting(true);

      const body = replyTo
        ? {
            action: "add_reply",
            postId: item.id,
            parentCommentId: replyTo.id,
            text,
          }
        : {
            action: "add_comment",
            postId: item.id,
            text,
          };

      const r = await fetch(`${base}/api/church/feed`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-kristo-user-id": effectiveAuthUserId,
          "x-kristo-role": effectiveAuthRole,
          "x-kristo-church-id": activeChurchId,
        },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        Alert.alert("Failed", String(j?.error || "Could not send comment."));
        return;
      }

      setComposer("");
      setReplyTo(null);
      await loadComments();
    } finally {
      setPosting(false);
    }
  };

  const totalComments = Number((detail?.item as any)?.commentCount ?? (item as any)?.commentCount ?? 0);
  const totalReplies = Number(detail?.item?.replyCount ?? 0);
  const totalDiscussion = Number(detail?.item?.totalDiscussionCount ?? (totalComments + totalReplies));
  const theme = kindTheme(item.kind);
  const isPrayerRequest = String((item as any)?.kind || "") === "prayer_request";
  const isGlobalPrayer = isPrayerRequest && /^global prayer request:/i.test(String(item.title || ""));
  const cleanPrayerTitle = isPrayerRequest
    ? String(item.title || "Prayer Request")
        .replace(/^global prayer request:s*/i, "")
        .replace(/^church prayer request:s*/i, "")
        .trim()
    : String(item.title || "Update");

  const rawTitle = isPrayerRequest
    ? String(cleanPrayerTitle || "").trim()
    : String(item.title || "").trim();

  const rawBody = String((item as any)?.body || (item as any)?.text || "").trim();
  const hasMedia = !!item.mediaUri;
  const hasTitle = !!rawTitle;
  const hasBody = !!rawBody;

  const cardVariant =
    hasMedia && (hasTitle || hasBody)
      ? "A"
      : !hasMedia && hasTitle && hasBody
      ? "B"
      : hasMedia && !hasTitle && !hasBody
      ? "C"
      : "D";

  const isNoMediaCard = !hasMedia;

  const inlinePreview =
    cardVariant === "A"
      ? buildInlinePreview(rawBody)
      : { preview: rawBody, previewText: rawBody, truncated: false };

  const titleStyle =
    cardVariant === "A"
      ? [styles.postHeaderTitle, styles.postHeaderTitleA, { color: theme.title }]
      : cardVariant === "B"
      ? [styles.postHeaderTitle, styles.postHeaderTitleB, { color: theme.title }]
      : cardVariant === "D"
      ? [styles.postHeaderTitle, styles.postHeaderTitleD, { color: theme.title }]
      : [styles.postHeaderTitle, { color: theme.title }];

  const headerSubStyle =
    cardVariant === "B"
      ? [styles.postAuthorSub, styles.postAuthorSubB, { color: theme.accent }]
      : cardVariant === "D"
      ? [styles.postAuthorSub, styles.postAuthorSubD, { color: theme.accent }]
      : [styles.postAuthorSub, { color: theme.accent }];

  const isAnnouncementA = item.kind === "announcement" && cardVariant === "A";

  const actorAvatarUri = String(
    (item as any)?.actorAvatarUri ??
    (item as any)?.actorAvatarUrl ??
    (item as any)?.actorAvatar ??
    (item as any)?.avatarUrl ??
    (item as any)?.avatar ??
    (item as any)?.profileImage ??
    (item as any)?.image ??
    ""
  ).trim();

  function openPosterProfile() {
    try {
      const actorName = String(item.actorLabel || "Kristo User").trim();
      const churchName = "Church";
      const posterUserId = String(
        (item as any)?.actorUserId ??
        (item as any)?.authorId ??
        (item as any)?.userId ??
        ""
      ).trim();
      const posterRole = String((item as any)?.actorRole || "Member").trim();

      if (posterUserId && effectiveAuthUserId && posterUserId === effectiveAuthUserId) {
        return;
      }

      router.push({
        pathname: "/poster-profile",
        params: {
          name: actorName,
          username: posterUserId ? "@" + posterUserId.toLowerCase().replace(/[^a-z0-9_]+/g, "_") : "",
          role: posterRole,
          church: churchName,
          userId: posterUserId,
          avatar: actorAvatarUri,
        },
      } as any);
    } catch {}
  }

  return (
    <View
      style={[
        styles.card,
        isAnnouncementA && styles.cardAnnouncementA,
        isNoMediaCard && styles.cardNoMedia,
        {
          borderColor: isAnnouncementA ? "rgba(235,195,96,0.28)" : theme.softBorder,
          backgroundColor: isPrayerRequest
            ? "rgba(24,20,30,0.94)"
            : isAnnouncementA
            ? "rgba(18,22,34,0.96)"
            : "rgba(20,24,36,0.92)",
          shadowColor: isAnnouncementA ? "#EBC360" : theme.accent,
        },
      ]}
    >
      {isAnnouncementA ? <View style={styles.cardAnnouncementAGlow} /> : null}
      <View
        style={[
          cardVariant === "A" && styles.cardVariantA,
          cardVariant === "B" && styles.cardVariantB,
          cardVariant === "C" && styles.cardVariantC,
          cardVariant === "D" && styles.cardVariantD,
          isNoMediaCard && styles.cardVariantNoMedia,
        ]}
      >
      <View style={styles.cardTop}>
        <View style={styles.postAuthorRow}>
          <Pressable
            onPress={openPosterProfile}
            hitSlop={10}
            style={styles.postAuthorLeft}
          >
            <View style={[styles.postAvatarOuter, { borderColor: theme.softBorder, backgroundColor: theme.softBg }]}>
              <View style={[styles.postAvatar, { borderColor: theme.avatarBorder, backgroundColor: theme.avatarBg }]}>
                {actorAvatarUri ? (
                  <Image
                    source={{ uri: actorAvatarUri }}
                    style={styles.postAvatarImage}
                    contentFit="cover"
                  />
                ) : (
                  <Text style={[styles.postAvatarText, { color: theme.accent }]}>
                    {String(item.actorLabel || "A").trim().charAt(0).toUpperCase() || "A"}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.postAuthorTextWrap}>
              <Text style={styles.postAuthorName} numberOfLines={1}>
                {toTitleCaseWords(item.actorLabel || "Admin")}
              </Text>

              {isAnnouncementA ? null : (
                <Text style={headerSubStyle} numberOfLines={1}>
                  {theme.label}
                </Text>
              )}
            </View>
          </Pressable>

          {isAnnouncementA ? (
            <View style={styles.headerRightStack}>
              <View style={styles.announceMiniPill}>
                <Ionicons
                  name="megaphone-outline"
                  size={11}
                  color={String(C.gold)}
                  style={styles.announceMiniIcon}
                />
                <Text style={styles.announceMiniText} numberOfLines={1}>
                  {theme.label}
                </Text>
              </View>

              <View style={styles.timeCapsule}>
                <Text style={styles.timeCapsuleText}>{fmtTime(item.createdAt)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.time}>{fmtTime(item.createdAt)}</Text>
          )}
        </View>

        {hasTitle ? (
          <Text
            style={[titleStyle, cardVariant === "A" && styles.postHeaderTitleA]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {rawTitle}
          </Text>
        ) : null}
      </View>

      {hasBody ? (
        <View
          style={[
            styles.postBodyWrap,
            cardVariant === "A" && styles.postBodyWrapA,
            cardVariant === "B" && styles.postBodyWrapB,
            cardVariant === "D" && styles.postBodyWrapD,
            isNoMediaCard && styles.postBodyWrapNoMedia,
            { borderColor: theme.softBorder, backgroundColor: theme.softBg },
          ]}
        >
          {cardVariant === "A" && !expanded ? (
            <Text
              style={[
                styles.postBodyText,
                styles.postBodyTextA,
              ]}
            >
              {inlinePreview.truncated ? (
                <Text onPress={onToggleReadMore}>
                  {inlinePreview.preview}
                  <Text style={styles.readMoreInlineTextA}> ... Read more</Text>
                </Text>
              ) : (
                inlinePreview.previewText
              )}
            </Text>
          ) : (
            <Text
              style={[
                styles.postBodyText,
                cardVariant === "A" && styles.postBodyTextA,
                cardVariant === "B" && styles.postBodyTextB,
                cardVariant === "D" && styles.postBodyTextD,
              ]}
              numberOfLines={expanded ? undefined : (cardVariant === "B" ? 8 : 5)}
              ellipsizeMode="tail"
            >
              {rawBody}
            </Text>
          )}
        </View>
      ) : null}

      {item.mediaUri ? (
        <View
          style={[
            styles.mediaWrap,
            cardVariant === "A" && styles.mediaWrapA,
            cardVariant === "C" && styles.mediaWrapC,
            { marginTop: hasBody ? 10 : 6 },
            mediaWrapVariant(item),
            { borderColor: theme.softBorder },
          ]}
        >
          {useSideFillBackground(item) ? (
            <>
              <Image
                source={item.mediaUri}
                style={[
                  styles.mediaBgFill,
                  mediaVariant(item),
                  { opacity: 0.18 },
                ]}
                contentFit="cover"
                contentPosition={backgroundContentPosition(item)}
                blurRadius={12}
              />
              <View style={styles.mediaBgOverlay} />
            </>
          ) : null}

          <Image
            source={item.mediaUri}
            style={[
              styles.media,
              mediaVariant(item),
              { transform: [{ scale: foregroundScale(item) }] },
            ]}
            contentFit={imageContentFit(item)}
            contentPosition={imageContentPosition(item)}
          />

          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              Alert.alert("Share", "Share feature coming next.");
            }}
            style={styles.mediaShareBtn}
          >
            <Ionicons
              name="share-social-outline"
              size={18}
              color="rgba(255,255,255,0.92)"
            />
          </Pressable>
        </View>
      ) : null}

      </View>

      <View style={[styles.actionsRow, isNoMediaCard && styles.actionsRowNoMedia]}>
        {isPrayerRequest ? (
          <>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                feedToggleLike(item.id);
              }}
              style={[
                styles.actionBtn,
                styles.prayerBtn,
                item.liked && styles.prayerBtnActive,
              ]}
            >
              <View style={[styles.prayerBtnInner, styles.prayerCommentBtnInner]}>
                <View style={styles.actionContent}>
                  <Text style={[styles.prayerEmoji, item.liked && styles.prayerEmojiActive]}>{item.liked ? "🙏🏿" : "🙏🏿"}</Text>
                  <Text style={[styles.actionCount, styles.prayerBtnText, item.liked && styles.prayerBtnTextActive]}>
                    {item.liked ? "Praying" : "Pray"}
                  </Text>
                </View>

                <View style={[styles.prayerCountPill, item.liked && styles.prayerCountPillActive]}>
                  <Text style={[styles.prayerCountText, item.liked && styles.prayerCountTextActive]}>
                    {item.likeCount ?? 0}
                  </Text>
                </View>
              </View>
            </Pressable>

            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
              style={[
                styles.actionBtn,
                styles.prayerCommentBtn,
                commentsOpen && styles.actionBtnCommentsOpen
              ]}
            >
              <View style={styles.prayerBtnInner}>
                <View style={styles.actionContent}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={20}
                    color="rgba(255,255,255,0.88)"
                  />
                  <Text style={[styles.actionCount, styles.prayerCommentText]}>Comment</Text>
                </View>

                <View style={styles.commentCountPill}>
                  <Text style={styles.commentCountText}>{totalComments}</Text>
                </View>
              </View>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                feedToggleLike(item.id);
              }}
              style={[styles.actionBtn, item.liked && styles.actionBtnLiked]}
            >
              <View style={styles.actionContent}>
                <Ionicons
                  name={item.liked ? "heart" : "heart-outline"}
                  size={22}
                  color={item.liked ? "#FF4D6D" : "rgba(255,255,255,0.82)"}
                />
                <Text style={styles.actionCount}>{item.likeCount ?? 0}</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
              style={[styles.actionBtn, commentsOpen && { borderColor: theme.softBorder, backgroundColor: theme.softBg }]}
            >
              <View style={styles.actionContent}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={22}
                  color="rgba(255,255,255,0.82)"
                />
                <Text style={styles.actionCount}>{totalComments}</Text>
              </View>
            </Pressable>

            {following ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  Alert.alert("Share", "Share feature coming next.");
                }}
                style={styles.actionBtn}
              >
                <View style={styles.actionContent}>
                  <Ionicons
                    name="share-social-outline"
                    size={18}
                    color="rgba(255,255,255,0.82)"
                  />
                  <Text style={styles.followActionText}>Share</Text>
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onToggleFollow();
                }}
                style={styles.actionBtn}
              >
                <View style={[styles.actionContent, styles.followActionContent]}>
                  <Ionicons
                    name="person-add-outline"
                    size={16}
                    color="rgba(255,255,255,0.78)"
                  />
                  <Text style={styles.followActionText}>Follow</Text>
                </View>
              </Pressable>
            )}

            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                feedToggleSave(item.id);
              }}
              style={[styles.actionBtn, item.saved && styles.actionBtnSaved]}
            >
              <Ionicons
                name={item.saved ? "bookmark" : "bookmark-outline"}
                size={22}
                color={item.saved ? String(C.gold) : "rgba(255,255,255,0.82)"}
              />
            </Pressable>
          </>
        )}
      </View>

    </View>
  );
}

const SCREEN_HEIGHT = Dimensions.get("window").height;
const CHURCH_FEED_SNAP = Math.max(560, SCREEN_HEIGHT - 150);
const SCREEN_WIDTH = Dimensions.get("window").width;

const styles = StyleSheet.create<any>({

  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { flex: 1, paddingHorizontal: S.pad, paddingTop: 10, paddingBottom: -6, overflow: "visible" },

  stickyProfileWrap: {
    position: "absolute",
    top: 0,
    left: S.pad,
    width: SCREEN_WIDTH - (S.pad * 2),
    zIndex: 20,
    backgroundColor: "transparent",
  },

  empty: {
    position: "relative",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(18,22,34,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 15,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    marginBottom: 4,
  },

  profileGlow: {
    position: "absolute",
    top: -10,
    left: 112,
    right: 112,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.045)",
  },

  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  profileLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  churchAvatarOuter: {
    width: 62,
    height: 62,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
    justifyContent: "center",
  },
  churchAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.48)",
    backgroundColor: "rgba(217,179,95,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  churchAvatarText: {
    color: C.gold,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1,
  },
  profileTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  profileEyebrow: {
    color: C.text.muted,
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  churchName: {
    color: "white",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  churchMeta: {
    marginTop: 4,
    color: C.text.secondary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  profileOverviewBtn: {
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  profileOverviewBtnGold: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(217,179,95,0.16)",
  },
  profileOverviewBtnText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  profileOverviewBtnTextGold: { color: C.gold },


  noChurchGate: {
    marginTop: 34,
    borderRadius: 28,
    padding: 20,
    minHeight: 310,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    overflow: "hidden",
  },
  noChurchGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -80,
    right: -60,
    backgroundColor: "rgba(217,179,95,0.13)",
  },
  noChurchIcon: {
    width: 72,
    height: 72,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    marginBottom: 18,
  },
  noChurchTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "950",
    textAlign: "center",
  },
  noChurchSub: {
    marginTop: 10,
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
  },
  noChurchActions: {
    width: "100%",
    marginTop: 22,
    gap: 12,
  },
  noChurchPrimary: {
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: C.gold,
  },
  noChurchPrimaryText: {
    color: "#0B0F17",
    fontWeight: "950",
    fontSize: 15,
  },
  noChurchSecondary: {
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  noChurchSecondaryText: {
    color: C.gold,
    fontWeight: "950",
    fontSize: 15,
  },

  snapItem: {
    minHeight: CHURCH_FEED_SNAP,
    justifyContent: "flex-start",
  },
  snapItemCentered: {
    justifyContent: "center",
    paddingTop: 0,
    paddingBottom: 54,
  },

  cardNoMedia: {
    maxWidth: "100%",
    minHeight: 0,
    width: "100%",
    alignSelf: "center",
  },

  cardVariantNoMedia: {
    paddingBottom: 4,
  },

  postBodyWrapNoMedia: {
    marginTop: 10,
    marginBottom: 2,
  },

  actionsRowNoMedia: {
    marginTop: 4,
  },

  card: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(18,22,34,0.90)",
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardTop: {
    marginTop: -2,
    marginBottom: 6,
  },
  postAuthorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginTop: 0,
    marginLeft: 0,
    paddingLeft: 0,
    gap: 10,
  },
  postAuthorLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingRight: 2,
  },
  postAvatarOuter: {
    width: 70,
    height: 70,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
    justifyContent: "center",
  },
  postAvatar: {
    width: 58,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.56)",
    backgroundColor: "rgba(217,179,95,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  postAvatarText: {
    color: C.gold,
    fontWeight: "900",
    fontSize: 28,
    letterSpacing: 0.2,
  },
  postAuthorTextWrap: {
  flex: 1,
  minWidth: 0,
  paddingTop: 14,
  justifyContent: "flex-start",
  paddingRight: 140,
},
  postAuthorName: {
  color: "white",
  fontWeight: "800",
  fontSize: 14,
  lineHeight: 18,
  letterSpacing: 0.02,
  marginTop: 0,
  textTransform: "none",
},
  postHeaderTitle: {
    marginTop: 10,
    marginLeft: 0,
    marginRight: 0,
    paddingLeft: 0,
    paddingRight: 0,
    color: "#63AEFF",
    fontWeight: "900",
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.18,
    textTransform: "uppercase",
    textAlign: "left",
    alignSelf: "stretch",
  },
  postHeaderTitleA: {
    marginTop: 8,
    marginLeft: 0,
    marginRight: 0,
    paddingLeft: 0,
    paddingRight: 0,
    alignSelf: "stretch",
  },

  postAuthorSub: {
    marginTop: 2,
    color: "rgba(255,215,120,0.95)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.42,
  },
  time: {
    marginTop: 2,
    color: "rgba(255,255,255,0.44)",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.22,
  },
  timeCapsule: {
  minWidth: 60,
  height: 24,
  marginTop: 6,
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 10,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "rgba(217,179,95,0.25)",
  backgroundColor: "rgba(255,255,255,0.04)",
},
  timeCapsuleText: {
    color: "rgba(255,255,255,0.78)",
    fontWeight: "800",
    fontSize: 7,
    letterSpacing: 0.03,
  },
  postAuthorTopRow: {
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  gap: 6,
},

  headerRightStack: {
  position: "absolute",
  right: 0,
  top: 0,
  alignItems: "flex-end",
},

  followBtn: {
  minHeight: 32,
  minWidth: 110,
  paddingHorizontal: 16,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.18)",
  backgroundColor: "rgba(255,255,255,0.06)",
  alignItems: "center",
  justifyContent: "center",
  alignSelf: "flex-start",
  marginLeft: 0,
  marginTop: -4,
},

  followBtnActive: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(217,179,95,0.12)",
  },

  followBtnText: {
  color: "rgba(255,255,255,0.95)",
  fontSize: 13,
  fontWeight: "700",
  letterSpacing: 0.05,
},

  followBtnTextActive: {
    color: C.gold,
  },

  announceRibbonIcon: {
    marginRight: 6,
  },

  postHeading: {
    marginTop: 2,
    color: "rgba(110,200,255,0.98)",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0.08,
  },

  postHeaderTitleB: {
    marginTop: 8,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: 0.07,
  },
  postHeaderTitleD: {
    marginTop: 7,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: 0.06,
  },
  postAuthorSubB: {
    marginTop: 4,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  postAuthorSubD: {
    marginTop: 4,
    fontSize: 11,
    letterSpacing: 0.48,
  },

  announceRibbon: {
    alignSelf: "flex-start",
    marginTop: 6,
    minHeight: 24,
    maxWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.11)",
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
  },
  announceRibbonText: {
    color: C.gold,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },

  
  announceMiniPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    maxWidth: 118,
    minHeight: 22,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  announceMiniIcon: {
    marginRight: 5,
  },
  announceMiniText: {
    color: C.gold,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "900",
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },

  messageLabel: {
    marginTop: 8,
    color: "rgba(255,255,255,0.44)",
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },

  cardAnnouncementA: {
    borderWidth: 1.2,
    overflow: "hidden",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardAnnouncementAGlow: {
    position: "absolute",
    top: -18,
    left: 118,
    right: 118,
    height: 54,
    borderRadius: 999,
    backgroundColor: "rgba(235,195,96,0.06)",
  },

  cardVariantA: {
    paddingBottom: 2,
  },
  cardVariantB: {
    paddingBottom: 2,
  },
  cardVariantC: {
    paddingBottom: 2,
  },
  cardVariantD: {
    paddingBottom: 2,
  },

  postBodyWrap: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  postBodyWrapA: {
    marginTop: 12,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(235,195,96,0.30)",
    backgroundColor: "rgba(34,37,49,0.94)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  postBodyWrapB: {
    marginTop: 12,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  postBodyWrapD: {
    marginTop: 12,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: "rgba(255,255,255,0.025)",
  },
  postBodyText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  postBodyTextA: {
    fontSize: 15,
    lineHeight: 25,
    fontWeight: "800",
    color: "rgba(255,255,255,0.94)",
    letterSpacing: 0.02,
  },
  postBodyTextB: {
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "800",
    color: "rgba(255,255,255,0.88)",
  },
  postBodyTextD: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
    color: "rgba(255,255,255,0.80)",
  },


  readMoreInlineTextA: {
    color: "rgba(235,195,96,0.98)",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.03,
  },

  mediaWrapA: {
    marginTop: 10,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  mediaWrapC: {
    marginTop: 10,
    borderRadius: 24,
    height: 560,
  },

  mediaWrap: {
  marginTop: 10,
  marginBottom: 0,
  height: 350,
  borderRadius: 18,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.10)",
  backgroundColor: "rgba(255,255,255,0.02)",
},
mediaWrapPortrait: {
  height: 336,
},
mediaWrapTall: {
  height: 382,
},
mediaWrapFullBody: {
  height: 418,
},
mediaWrapSeated: {
  height: 452,
},
mediaWrapDesk: {
  height: 472,
},
mediaWrapNarrowGroup: {
  height: 330,
},
media: {
  width: "100%",
  height: "100%",
},
mediaBgFill: {
  ...StyleSheet.absoluteFillObject,
},
mediaBgOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(8,10,18,0.10)",
},
mediaPortrait: {
  height: 336,
},
mediaTall: {
  height: 382,
},
mediaFullBody: {
  height: 418,
},
mediaSeated: {
  height: 452,
},
mediaDesk: {
  height: 472,
},
mediaNarrowGroup: {
  height: 330,
},
body: {
    marginBottom: 2,
    marginTop: 2,
    color: "rgba(255,255,255,0.76)",
    fontSize: 15,
    lineHeight: 26,
    fontWeight: "700",
  },

  bodyMeasureWrap: {
    position: "absolute",
    left: 14,
    right: 14,
    opacity: 0,
    zIndex: -1,
  },

  readMoreBtn: {
    alignSelf: "flex-start",
    marginTop: 2,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    minHeight: 0,
  },
  readMoreText: {
    color: "rgba(110,200,255,0.98)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 0.02,
  },

  actionsRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 12,
  paddingBottom: 8,
},
  actionBtn: {
  flex: 1,
  minHeight: 56,
  borderRadius: 18,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.10)",
  backgroundColor: "rgba(255,255,255,0.035)",
  alignItems: "center",
  justifyContent: "center",
},
  actionBtnLiked: {
    borderColor: "rgba(255,77,109,0.52)",
    backgroundColor: "rgba(255,77,109,0.14)",
  },
  actionBtnSaved: {
    borderColor: "rgba(217,179,95,0.42)",
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  actionBtnCommentsOpen: {
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(255,255,255,0.075)",
  },
  actionContent: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
},
  followActionContent: {
  gap: 5,
  transform: [{ translateY: -0.5 }],
},
  actionCount: {
  color: "rgba(255,255,255,0.95)",
  fontSize: 15,
  fontWeight: "900",
  letterSpacing: 0.15,
},
  followActionText: {
  color: "rgba(255,255,255,0.92)",
  fontSize: 11,
  fontWeight: "800",
  letterSpacing: 0.03,
},
  mediaShareBtn: {
  position: "absolute",
  right: 12,
  bottom: 12,
  width: 42,
  height: 42,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.18)",
  backgroundColor: "rgba(12,18,34,0.64)",
  alignItems: "center",
  justifyContent: "center",
},

  prayerBtn: {
    flex: 1.26,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },

  prayerBtnActive: {
    borderWidth: 1.2,
    borderColor: "rgba(255,210,140,0.45)",
    backgroundColor: "rgba(255,210,140,0.14)",
    shadowColor: "rgba(255,200,120,0.45)",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    transform: [{ scale: 1.02 }],
  },
  prayerBtnInner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  prayerCommentBtnInner: {
    width: "100%",
    flex: 1,
    justifyContent: "flex-start",
    gap: 8,
  },
  prayerEmoji: {
    fontSize: 18,
    lineHeight: 20,
    marginRight: 1,
    opacity: 0.92,
  },
  prayerEmojiActive: {
    opacity: 1,
    transform: [{ scale: 1.16 }],
  },
  prayerBtnText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    fontSize: 14,
  },

  prayerBtnTextActive: {
    color: "#FFD98A",
  },
  prayerCountPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  prayerCountPillActive: {
    borderColor: "rgba(255,215,120,0.6)",
    backgroundColor: "rgba(255,215,120,0.22)",
  },
  prayerCountText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "900",
  },

  prayerCountTextActive: {
    color: "#FFD98A",
  },
  prayerCommentBtn: {
    flex: 1.08,
    minHeight: 46,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.028)",
    overflow: "hidden",
  },
  postAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 17,
  },
  prayerCommentText: {
    color: "rgba(255,255,255,0.94)",
    fontWeight: "900",
    fontSize: 14,
  },
  commentCountPill: {
    minWidth: 24,
    height: 24,
    borderRadius: 999,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexShrink: 0,
    marginLeft: "auto",
  },
  commentCountText: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 12,
    fontWeight: "900",
  },

  commentsPanel: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  commentsTop: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 2,
  },
  commentsTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 20,
    letterSpacing: 0.15,
  },
  commentsMeta: {
    color: C.text.secondary,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.25,
  },

  summaryRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  summaryPillText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.2,
  },

  replyBadge: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    backgroundColor: "rgba(217,179,95,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  replyBadgeText: {
    flex: 1,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "800",
    fontSize: 12,
  },
  replyBadgeClear: {
    color: C.gold,
    fontWeight: "900",
    fontSize: 12,
  },

  composer: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.035)",
    padding: 12,
  },
  input: {
    minHeight: 84,
    color: "white",
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
    paddingHorizontal: 2,
    paddingTop: 2,
  },
  sendBtn: {
    marginTop: 12,
    alignSelf: "flex-end",
    minWidth: 92,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendBtnText: {
    color: "#111",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.2,
  },

  inlineLoadingBox: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.025)",
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  inlineLoadingText: {
    color: C.text.secondary,
    fontWeight: "800",
    fontSize: 12,
  },

  commentsList: {
    marginTop: 14,
    gap: 12,
  },
  commentCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.02)",
    padding: 13,
  },
  commentTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  commentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  commentAvatarText: {
    color: C.gold,
    fontWeight: "900",
    fontSize: 14,
  },
  commentName: {
    color: "white",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.15,
  },
  commentTime: {
    color: C.text.muted,
    fontWeight: "700",
    fontSize: 10,
    marginTop: 2,
  },
  commentBody: {
    marginTop: 2,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "800",
    fontSize: 14,
    lineHeight: 22,
  },
  commentActions: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  replyBtn: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  replyBtnText: {
    color: C.gold,
    fontWeight: "900",
    fontSize: 11,
  },
  replyCountText: {
    color: C.text.secondary,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.15,
  },

  repliesWrap: {
    marginTop: 12,
    gap: 10,
    paddingLeft: 12,
    marginLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(217,179,95,0.20)",
  },
  replyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    backgroundColor: "rgba(255,255,255,0.02)",
    padding: 10,
  },
  replyTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  replyAvatar: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  replyAvatarText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },
  replyName: {
    color: "white",
    fontWeight: "900",
    fontSize: 13,
  },
  replyTime: {
    color: C.text.muted,
    fontWeight: "700",
    fontSize: 10,
    marginTop: 1,
  },
  replyBody: {
    marginTop: 8,
    color: "rgba(255,255,255,0.88)",
    fontWeight: "800",
    fontSize: 13,
    lineHeight: 20,
  },

  commentsEmpty: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.025)",
    padding: 16,
  },
  commentsEmptyTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 15,
  },
  commentsEmptyText: {
    marginTop: 6,
    color: C.text.secondary,
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 18,
  },

  prayerMetaRow: {
    marginTop: 6,
    marginBottom: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  prayerScopeBadge: {
    minHeight: 22,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  prayerScopeBadgeGlobal: {
    borderColor: "rgba(255,120,120,0.24)",
    backgroundColor: "rgba(255,120,120,0.10)",
  },
  prayerScopeBadgeChurch: {
    borderColor: "rgba(255,190,190,0.20)",
    backgroundColor: "rgba(255,190,190,0.08)",
  },
  prayerScopeBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  prayerScopeBadgeTextGlobal: {
    color: "rgba(255,170,170,0.98)",
  },
  prayerScopeBadgeTextChurch: {
    color: "rgba(255,210,210,0.96)",
  },
  prayerHeading: {
    marginTop: 2,
  },
  prayerHeadingClean: {
    color: "rgba(255,225,140,1)",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "900",
    letterSpacing: 0.02,
  },
  prayerBody: {
    color: "rgba(255,255,255,0.74)",
    fontWeight: "700",
    lineHeight: 26,
  },

  openMessageBtn: {
    marginTop: 18,
    marginBottom: 4,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  
openMessageText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  titleRow: {
    marginTop: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  titleRowText: {
    flex: 1,
    marginTop: 0
  },
  openMessageInline: {
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  openMessageInlineText: {
    fontSize: 12,
    fontWeight: "900"
  },


});