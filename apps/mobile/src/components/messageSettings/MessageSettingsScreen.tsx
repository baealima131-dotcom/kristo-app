import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  fetchMessagePrivacySettings,
  patchMessagePrivacySettings,
} from "@/src/lib/messagePrivacySettingsApi";
import { cacheMessageMediaDefaults } from "@/src/lib/messageMediaDefaults";
import {
  AUTO_DELETE_OPTIONS,
  DEFAULT_MESSAGE_PRIVACY_SETTINGS,
  DOWNLOAD_MODE_OPTIONS,
  MEDIA_QUALITY_OPTIONS,
  WHO_CAN_CALL_OPTIONS,
  WHO_CAN_MESSAGE_OPTIONS,
  labelForAutoDelete,
  labelForDownloadMode,
  labelForMediaQuality,
  labelForWhoCanCall,
  labelForWhoCanMessage,
  type AutoDeleteDownloadedMedia,
  type DownloadMode,
  type MediaQuality,
  type MessagePrivacySettingsPatch,
  type MessagePrivacySettingsV1,
  type WhoCanCall,
  type WhoCanMessage,
} from "@/src/lib/messagePrivacySettingsTypes";
import { MessageLockSettingsSection } from "./MessageLockSettingsSection";
import { SettingsChoiceRow } from "./SettingsChoiceRow";
import { SettingsChoiceSheet } from "./SettingsChoiceSheet";
import { SettingsNavRow } from "./SettingsNavRow";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { SettingsToggleRow } from "./SettingsToggleRow";
import {
  MS_BG,
  MS_BORDER,
  MS_CARD,
  MS_DANGER,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

type ChoiceSheetState =
  | { kind: "whoCanMessage" }
  | { kind: "whoCanCall" }
  | { kind: "downloadMode" }
  | { kind: "mediaQuality" }
  | { kind: "autoDeleteDownloadedMedia" }
  | null;

export function MessageSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [settings, setSettings] = useState<MessagePrivacySettingsV1>(
    DEFAULT_MESSAGE_PRIVACY_SETTINGS
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<ChoiceSheetState>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchMessagePrivacySettings();
      setSettings(next);
      void cacheMessageMediaDefaults(next);
    } catch (e: any) {
      setError(String(e?.message || "Could not load message settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPatch = useCallback(async (patch: MessagePrivacySettingsPatch) => {
    const previous = settingsRef.current;
    const optimistic = { ...previous, ...patch } as MessagePrivacySettingsV1;
    setSettings(optimistic);
    setSaving(true);
    setError("");
    try {
      const saved = await patchMessagePrivacySettings(patch);
      setSettings(saved);
      void cacheMessageMediaDefaults(saved);
    } catch (e: any) {
      setSettings(previous);
      setError(String(e?.message || "Could not save. Changes were reverted."));
    } finally {
      setSaving(false);
    }
  }, []);

  const sheetConfig = useMemo(() => {
    if (!sheet) return null;
    if (sheet.kind === "whoCanMessage") {
      return {
        title: "Who can message me",
        options: WHO_CAN_MESSAGE_OPTIONS,
        selected: settings.whoCanMessage,
        onSelect: (value: WhoCanMessage) =>
          void applyPatch({ whoCanMessage: value }),
      };
    }
    if (sheet.kind === "whoCanCall") {
      return {
        title: "Who can call me",
        options: WHO_CAN_CALL_OPTIONS,
        selected: settings.whoCanCall,
        onSelect: (value: WhoCanCall) => void applyPatch({ whoCanCall: value }),
      };
    }
    if (sheet.kind === "downloadMode") {
      return {
        title: "Download mode",
        options: DOWNLOAD_MODE_OPTIONS,
        selected: settings.downloadMode,
        onSelect: (value: DownloadMode) =>
          void applyPatch({ downloadMode: value }),
      };
    }
    if (sheet.kind === "mediaQuality") {
      return {
        title: "Media quality",
        options: MEDIA_QUALITY_OPTIONS,
        selected: settings.mediaQuality,
        onSelect: (value: MediaQuality) =>
          void applyPatch({ mediaQuality: value }),
      };
    }
    return {
      title: "Auto-delete downloaded media",
      options: AUTO_DELETE_OPTIONS,
      selected: settings.autoDeleteDownloadedMedia,
      onSelect: (value: AutoDeleteDownloadedMedia) =>
        void applyPatch({ autoDeleteDownloadedMedia: value }),
    };
  }, [applyPatch, settings, sheet]);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => [s.headerBtn, pressed ? s.pressed : null]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={20} color={MS_TEXT} />
        </Pressable>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>Message settings</Text>
          <Text style={s.headerSub}>Privacy across all churches</Text>
        </View>
        <View style={s.headerTrailing}>
          {saving ? (
            <ActivityIndicator color={MS_GOLD} size="small" />
          ) : (
            <View style={s.headerTrailingGhost} />
          )}
        </View>
      </View>

      {error ? (
        <View style={s.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={MS_DANGER} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => void load()}
            hitSlop={8}
          >
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator color={MS_GOLD} />
          <Text style={s.loadingText}>Loading settings…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            s.content,
            { paddingBottom: insets.bottom + 28 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <SettingsSectionCard
            title="Message Privacy"
            subtitle="Controls who can start or continue messaging you."
          >
            <SettingsChoiceRow
              label="Who can message me"
              valueLabel={labelForWhoCanMessage(settings.whoCanMessage)}
              onPress={() => setSheet({ kind: "whoCanMessage" })}
              accessibilityLabel="Who can message me"
            />
            <SettingsToggleRow
              label="Allow messages from other churches"
              description="When off, cross-church message requests are blocked."
              value={settings.allowMessagesFromOtherChurches}
              onValueChange={(v) =>
                void applyPatch({ allowMessagesFromOtherChurches: v })
              }
            />
            <SettingsToggleRow
              label="Allow message requests"
              description="When off, new outside-church invitations are declined."
              value={settings.allowMessageRequests}
              onValueChange={(v) =>
                void applyPatch({ allowMessageRequests: v })
              }
            />
            <SettingsToggleRow
              label="Filter suspicious or spam requests"
              description="Uses Kristo’s request limits to filter repeated spam."
              value={settings.filterSuspiciousRequests}
              onValueChange={(v) =>
                void applyPatch({ filterSuspiciousRequests: v })
              }
            />
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Calling Privacy"
            subtitle="Applies only to pastoral pastor ↔ member calls."
          >
            <SettingsToggleRow
              label="Allow voice calls"
              value={settings.allowVoiceCalls}
              onValueChange={(v) => void applyPatch({ allowVoiceCalls: v })}
            />
            <SettingsToggleRow
              label="Allow video calls"
              description="Stored for when pastoral video calling is available."
              value={settings.allowVideoCalls}
              onValueChange={(v) => void applyPatch({ allowVideoCalls: v })}
            />
            <SettingsChoiceRow
              label="Who can call me"
              valueLabel={labelForWhoCanCall(settings.whoCanCall)}
              onPress={() => setSheet({ kind: "whoCanCall" })}
            />
            <SettingsToggleRow
              label="Automatically reject unknown callers"
              description="Rejects pastoral callers with no existing conversation."
              value={settings.autoRejectUnknownCallers}
              onValueChange={(v) =>
                void applyPatch({ autoRejectUnknownCallers: v })
              }
            />
          </SettingsSectionCard>

          <SettingsSectionCard title="Read & Activity Privacy">
            <SettingsToggleRow
              label="Show read receipts"
              description="Both people must enable this to show Read."
              value={settings.showReadReceipts}
              onValueChange={(v) => void applyPatch({ showReadReceipts: v })}
            />
            <SettingsToggleRow
              label="Show online status"
              value={settings.showOnlineStatus}
              onValueChange={(v) => void applyPatch({ showOnlineStatus: v })}
            />
            <SettingsToggleRow
              label="Show last active time"
              value={settings.showLastActive}
              onValueChange={(v) => void applyPatch({ showLastActive: v })}
            />
            <SettingsToggleRow
              label="Show typing indicator"
              value={settings.showTypingIndicator}
              onValueChange={(v) =>
                void applyPatch({ showTypingIndicator: v })
              }
            />
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Notifications & Previews"
            subtitle="Private-call notifications are enforced server-side. Mute-all and DM preview coverage is partial until a dedicated DM push path ships."
          >
            <SettingsToggleRow
              label="Show message previews"
              value={settings.showMessagePreviews}
              onValueChange={(v) =>
                void applyPatch({ showMessagePreviews: v })
              }
            />
            <SettingsToggleRow
              label="Show sender name in notifications"
              value={settings.showSenderNameInNotifications}
              onValueChange={(v) =>
                void applyPatch({ showSenderNameInNotifications: v })
              }
            />
            <SettingsToggleRow
              label="Mute all message notifications"
              value={settings.muteAllMessageNotifications}
              onValueChange={(v) =>
                void applyPatch({ muteAllMessageNotifications: v })
              }
            />
            <SettingsToggleRow
              label="Private-call notifications"
              value={settings.privateCallNotifications}
              onValueChange={(v) =>
                void applyPatch({ privateCallNotifications: v })
              }
            />
          </SettingsSectionCard>

          {/* Gate already unlocked when this screen is visible with lock on. */}
          <MessageLockSettingsSection gateUnlocked />

          <SettingsSectionCard
            title="Safety & Control"
            subtitle="Manage people and conversations you already control."
          >
            <SettingsNavRow
              icon="ban-outline"
              label="Blocked users"
              description="People you blocked in Messages"
              onPress={() =>
                router.push(
                  "/(tabs)/more/my-church-room/messages/settings/blocked" as any
                )
              }
            />
            <SettingsNavRow
              icon="notifications-off-outline"
              label="Muted conversations"
              onPress={() =>
                router.push(
                  "/(tabs)/more/my-church-room/messages/settings/muted" as any
                )
              }
            />
            <SettingsNavRow
              icon="eye-off-outline"
              label="Hidden conversations"
              description="Conversations you deleted from your inbox"
              onPress={() =>
                router.push(
                  "/(tabs)/more/my-church-room/messages/settings/hidden" as any
                )
              }
            />
            <SettingsNavRow
              icon="flag-outline"
              label="Report history"
              description="Track reports in MY WAY"
              last
              onPress={() =>
                router.push("/(tabs)/more/my-reports" as any)
              }
            />
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Storage & Media"
            subtitle="Global defaults only. Per-conversation Media Storage is unchanged."
          >
            <SettingsToggleRow
              label="Auto-download photos"
              value={settings.autoDownloadPhotos}
              onValueChange={(v) =>
                void applyPatch({ autoDownloadPhotos: v })
              }
            />
            <SettingsToggleRow
              label="Auto-download videos"
              value={settings.autoDownloadVideos}
              onValueChange={(v) =>
                void applyPatch({ autoDownloadVideos: v })
              }
            />
            <SettingsToggleRow
              label="Auto-download audio"
              value={settings.autoDownloadAudio}
              onValueChange={(v) => void applyPatch({ autoDownloadAudio: v })}
            />
            <SettingsToggleRow
              label="Auto-download documents"
              value={settings.autoDownloadDocuments}
              onValueChange={(v) =>
                void applyPatch({ autoDownloadDocuments: v })
              }
            />
            <SettingsChoiceRow
              label="Download mode"
              valueLabel={labelForDownloadMode(settings.downloadMode)}
              onPress={() => setSheet({ kind: "downloadMode" })}
            />
            <SettingsChoiceRow
              label="Media quality"
              valueLabel={labelForMediaQuality(settings.mediaQuality)}
              onPress={() => setSheet({ kind: "mediaQuality" })}
            />
            <SettingsChoiceRow
              label="Auto-delete downloaded media"
              valueLabel={labelForAutoDelete(settings.autoDeleteDownloadedMedia)}
              onPress={() => setSheet({ kind: "autoDeleteDownloadedMedia" })}
            />
          </SettingsSectionCard>

          <Text style={s.footnote}>
            Existing conversations are never deleted when you change these
            settings. Blocked users stay blocked regardless of privacy rules.
          </Text>
        </ScrollView>
      )}

      {sheetConfig ? (
        <SettingsChoiceSheet
          visible={!!sheet}
          title={sheetConfig.title}
          options={sheetConfig.options as any}
          selected={sheetConfig.selected as any}
          onSelect={sheetConfig.onSelect as any}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: MS_BG,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MS_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MS_BORDER,
  },
  pressed: {
    opacity: 0.85,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: MS_TEXT,
    fontSize: 20,
    fontWeight: "750" as any,
  },
  headerSub: {
    color: MS_SUB,
    fontSize: 12,
  },
  headerTrailing: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTrailingGhost: {
    width: 20,
    height: 20,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,107,107,0.45)",
    backgroundColor: "rgba(255,107,107,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: MS_TEXT,
    fontSize: 12,
    lineHeight: 16,
  },
  retryText: {
    color: MS_GOLD,
    fontSize: 12,
    fontWeight: "700",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: MS_SUB,
    fontSize: 13,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  footnote: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
});
