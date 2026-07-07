import React, { useEffect, useMemo, useRef } from "react";
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import LiveMainStageSaturnOrbit from "@/src/components/live/LiveMainStageSaturnOrbit";
import {
  liveSlotPlaceholderStatusLabel,
  resolveLiveSlotPlaceholderStatus,
  sanitizeLiveSlotDisplayName,
  type LiveSlotPlaceholderStatus,
} from "@/src/lib/liveSlotPlaceholderStatus";

export type LiveSlotIdentityPlaceholderProps = {
  slotId?: string;
  slotNumber?: number;
  claimedByUserId?: string;
  claimedUserName?: string;
  claimedUserAvatarUrl?: string;
  ministryName?: string;
  ministryAvatarUrl?: string;
  churchName?: string;
  churchAvatarUrl?: string;
  participantJoined?: boolean;
  cameraEnabled?: boolean;
  participantDisconnected?: boolean;
  slotIsOpen?: boolean;
  liveScope?: "ministry" | "church" | "media";
  variant?: "main" | "side-rail" | "bottom-tile" | "open";
  ringColor?: string;
  hideWhenLive?: boolean;
  identityRole?: string;
  style?: ViewStyle;
};

type MainStageIdentitySource = "claimed-user" | "ministry" | "church" | "initials";

function resolveMainStageIdentity(props: LiveSlotIdentityPlaceholderProps): {
  resolvedName: string;
  avatarUri: string;
  resolvedSource: MainStageIdentitySource;
} {
  const claimedId = String(props.claimedByUserId || "").trim();
  const ministryName = sanitizeLiveSlotDisplayName(
    String(props.ministryName || props.churchName || "Open slot"),
    "Open slot"
  );
  const claimedName = sanitizeLiveSlotDisplayName(String(props.claimedUserName || ""), "Speaker");

  if (claimedId) {
    if (isImageUri(props.claimedUserAvatarUrl)) {
      return {
        resolvedName: claimedName,
        avatarUri: String(props.claimedUserAvatarUrl),
        resolvedSource: "claimed-user",
      };
    }
    if (isImageUri(props.ministryAvatarUrl)) {
      return {
        resolvedName: claimedName,
        avatarUri: String(props.ministryAvatarUrl),
        resolvedSource: "ministry",
      };
    }
    if (isImageUri(props.churchAvatarUrl)) {
      return {
        resolvedName: claimedName,
        avatarUri: String(props.churchAvatarUrl),
        resolvedSource: "church",
      };
    }
    return { resolvedName: claimedName, avatarUri: "", resolvedSource: "initials" };
  }

  if (isImageUri(props.ministryAvatarUrl)) {
    return {
      resolvedName: ministryName,
      avatarUri: String(props.ministryAvatarUrl),
      resolvedSource: "ministry",
    };
  }
  if (isImageUri(props.churchAvatarUrl)) {
    return {
      resolvedName: ministryName,
      avatarUri: String(props.churchAvatarUrl),
      resolvedSource: "church",
    };
  }
  return { resolvedName: ministryName, avatarUri: "", resolvedSource: "initials" };
}

function isImageUri(value?: string): boolean {
  const uri = String(value || "").trim();
  return uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("file://");
}

function initialsFromName(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function variantStyles(variant: LiveSlotIdentityPlaceholderProps["variant"]) {
  switch (variant) {
    case "main":
      return {
        avatarSize: 118,
        avatarTextSize: 42,
        statusFontSize: 13,
        nameFontSize: 16,
        iconSize: 34,
      };
    case "side-rail":
      return {
        avatarSize: 54,
        avatarTextSize: 18,
        statusFontSize: 9,
        nameFontSize: 10,
        iconSize: 22,
      };
    case "open":
    case "bottom-tile":
    default:
      return {
        avatarSize: 52,
        avatarTextSize: 18,
        statusFontSize: 10,
        nameFontSize: 12,
        iconSize: 22,
      };
  }
}

export default function LiveSlotIdentityPlaceholder(props: LiveSlotIdentityPlaceholderProps) {
  const variant = props.variant || "bottom-tile";
  const metrics = variantStyles(variant);
  const renderLoggedRef = useRef("");
  const isMainStage = variant === "main";

  const status: LiveSlotPlaceholderStatus = useMemo(
    () =>
      resolveLiveSlotPlaceholderStatus({
        slotIsOpen: props.slotIsOpen === true,
        claimedByUserId: props.claimedByUserId,
        participantJoined: props.participantJoined === true,
        cameraEnabled: props.cameraEnabled === true,
        participantDisconnected: props.participantDisconnected === true,
      }),
    [
      props.slotIsOpen,
      props.claimedByUserId,
      props.participantJoined,
      props.cameraEnabled,
      props.participantDisconnected,
    ]
  );

  const statusLabel = useMemo(() => {
    if (status === "open_slot") {
      if (props.liveScope === "church") return "Waiting for participant";
      return "Open slot";
    }
    return liveSlotPlaceholderStatusLabel(status, props.claimedUserName);
  }, [status, props.liveScope, props.claimedUserName]);

  const showStatusPill = useMemo(() => {
    if (props.slotIsOpen && props.liveScope === "ministry") return false;
    if (status === "open_slot") return props.liveScope === "church";
    return status === "not_joined" || status === "camera_off" || status === "left";
  }, [props.slotIsOpen, props.liveScope, status]);

  const resolvedIdentity = useMemo(
    () => resolveMainStageIdentity(props),
    [
      props.claimedByUserId,
      props.claimedUserName,
      props.claimedUserAvatarUrl,
      props.ministryName,
      props.ministryAvatarUrl,
      props.churchName,
      props.churchAvatarUrl,
    ]
  );

  const displayName = resolvedIdentity.resolvedName;
  const avatarUri = resolvedIdentity.avatarUri;

  const hideWhenLive = props.hideWhenLive !== false;
  const identityFallbackLoggedRef = useRef("");

  useEffect(() => {
    if (variant !== "main") return;
    const sig = [
      props.identityRole || "",
      props.slotId,
      status,
      props.claimedByUserId,
      resolvedIdentity.resolvedSource,
      resolvedIdentity.resolvedName,
      avatarUri,
    ].join("|");
    if (identityFallbackLoggedRef.current === sig) return;
    identityFallbackLoggedRef.current = sig;
    console.log("KRISTO_MAIN_STAGE_IDENTITY_FALLBACK", {
      role: String(props.identityRole || "unknown"),
      slotId: props.slotId || "",
      status,
      claimedByUserId: props.claimedByUserId || "",
      hasClaimedAvatar: isImageUri(props.claimedUserAvatarUrl),
      hasMinistryAvatar: isImageUri(props.ministryAvatarUrl),
      hasChurchAvatar: isImageUri(props.churchAvatarUrl),
      resolvedName: resolvedIdentity.resolvedName,
      resolvedSource: resolvedIdentity.resolvedSource,
    });
  }, [
    variant,
    props.identityRole,
    props.slotId,
    props.claimedByUserId,
    props.claimedUserAvatarUrl,
    props.ministryAvatarUrl,
    props.churchAvatarUrl,
    status,
    resolvedIdentity.resolvedName,
    resolvedIdentity.resolvedSource,
    avatarUri,
  ]);

  useEffect(() => {
    if (hideWhenLive && status === "live") return;
    const sig = [
      props.slotId,
      props.slotNumber,
      props.claimedByUserId,
      status,
      props.participantJoined,
      props.cameraEnabled,
    ].join("|");
    if (renderLoggedRef.current === sig) return;
    renderLoggedRef.current = sig;
    console.log("KRISTO_LIVE_SLOT_PLACEHOLDER_RENDER", {
      slotId: props.slotId || "",
      slotNumber: props.slotNumber ?? null,
      claimedByUserId: props.claimedByUserId || "",
      hasClaimedAvatar: isImageUri(props.claimedUserAvatarUrl),
      hasMinistryAvatar: isImageUri(props.ministryAvatarUrl),
      hasChurchAvatar: isImageUri(props.churchAvatarUrl),
      participantJoined: props.participantJoined === true,
      cameraEnabled: props.cameraEnabled === true,
      participantDisconnected: props.participantDisconnected === true,
      slotIsOpen: props.slotIsOpen === true,
      status,
      showStatusPill,
    });
  }, [
    hideWhenLive,
    props.slotId,
    props.slotNumber,
    props.claimedByUserId,
    props.claimedUserAvatarUrl,
    props.ministryAvatarUrl,
    props.churchAvatarUrl,
    props.participantJoined,
    props.cameraEnabled,
    props.participantDisconnected,
    props.slotIsOpen,
    status,
    showStatusPill,
  ]);

  if (hideWhenLive && status === "live") return null;

  const fallbackInitials = initialsFromName(displayName);

  const avatarContent = (
    <View
      style={[
        styles.avatarWrap,
        {
          width: metrics.avatarSize,
          height: metrics.avatarSize,
          borderRadius: metrics.avatarSize / 2,
          borderColor: props.ringColor || "rgba(244,201,93,0.85)",
        },
      ]}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
      ) : props.slotIsOpen && !String(props.claimedByUserId || "").trim() ? (
        <Ionicons name="business-outline" size={metrics.iconSize} color="#F4D06F" />
      ) : (
        <Text style={[styles.avatarInitials, { fontSize: metrics.avatarTextSize }]}>
          {fallbackInitials}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.root, props.style]} pointerEvents="none">
      {isMainStage ? (
        <LiveMainStageSaturnOrbit
          size={metrics.avatarSize}
          ringColor={props.ringColor || "rgba(244,208,111,0.62)"}
        >
          {avatarContent}
        </LiveMainStageSaturnOrbit>
      ) : (
        avatarContent
      )}

      {variant !== "side-rail" ? (
        <Text style={[styles.displayName, { fontSize: metrics.nameFontSize }]} numberOfLines={1}>
          {displayName}
        </Text>
      ) : null}

      {showStatusPill ? (
        <View style={styles.statusPill}>
          <Text style={[styles.statusText, { fontSize: metrics.statusFontSize }]} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  avatarWrap: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 2,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarInitials: {
    color: "#F4D06F",
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  displayName: {
    color: "#F4D06F",
    fontWeight: "800",
    letterSpacing: 0.3,
    maxWidth: 168,
    textAlign: "center",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(8,12,24,0.82)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.42)",
  },
  statusText: {
    color: "rgba(255,236,198,0.92)",
    fontWeight: "700",
    letterSpacing: 0.2,
    textAlign: "center",
  },
});
