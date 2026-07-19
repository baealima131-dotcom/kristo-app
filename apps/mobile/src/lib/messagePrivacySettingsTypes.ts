export type WhoCanMessage =
  | "everyone"
  | "church_members"
  | "existing_conversations"
  | "nobody";

export type WhoCanCall =
  | "everyone"
  | "church_members"
  | "existing_conversations"
  | "nobody";

export type MessageLockTimeout = "immediate" | "1m" | "5m" | "15m";

export type DownloadMode = "wifi_only" | "wifi_and_cellular" | "never";

export type MediaQuality = "high" | "standard" | "data_saver";

export type AutoDeleteDownloadedMedia = "never" | "30d" | "90d" | "1y";

export type MessagePrivacySettingsV1 = {
  version: 1;
  updatedAt: number;
  whoCanMessage: WhoCanMessage;
  allowMessagesFromOtherChurches: boolean;
  allowMessageRequests: boolean;
  filterSuspiciousRequests: boolean;
  allowVoiceCalls: boolean;
  allowVideoCalls: boolean;
  whoCanCall: WhoCanCall;
  autoRejectUnknownCallers: boolean;
  showReadReceipts: boolean;
  showOnlineStatus: boolean;
  showLastActive: boolean;
  showTypingIndicator: boolean;
  showMessagePreviews: boolean;
  showSenderNameInNotifications: boolean;
  muteAllMessageNotifications: boolean;
  privateCallNotifications: boolean;
  requireDeviceAuthForMessages: boolean;
  messageLockTimeout: MessageLockTimeout;
  hideContentInAppSwitcher: boolean;
  autoDownloadPhotos: boolean;
  autoDownloadVideos: boolean;
  autoDownloadAudio: boolean;
  autoDownloadDocuments: boolean;
  downloadMode: DownloadMode;
  mediaQuality: MediaQuality;
  autoDeleteDownloadedMedia: AutoDeleteDownloadedMedia;
};

export type MessagePrivacySettingsPatch = Partial<
  Omit<MessagePrivacySettingsV1, "version" | "updatedAt">
>;

export const DEFAULT_MESSAGE_PRIVACY_SETTINGS: MessagePrivacySettingsV1 = {
  version: 1,
  updatedAt: 0,
  whoCanMessage: "everyone",
  allowMessagesFromOtherChurches: true,
  allowMessageRequests: true,
  filterSuspiciousRequests: false,
  allowVoiceCalls: true,
  allowVideoCalls: true,
  whoCanCall: "everyone",
  autoRejectUnknownCallers: false,
  showReadReceipts: true,
  showOnlineStatus: true,
  showLastActive: true,
  showTypingIndicator: true,
  showMessagePreviews: true,
  showSenderNameInNotifications: true,
  muteAllMessageNotifications: false,
  privateCallNotifications: true,
  requireDeviceAuthForMessages: false,
  messageLockTimeout: "immediate",
  hideContentInAppSwitcher: false,
  autoDownloadPhotos: true,
  autoDownloadVideos: false,
  autoDownloadAudio: false,
  autoDownloadDocuments: false,
  downloadMode: "wifi_only",
  mediaQuality: "standard",
  autoDeleteDownloadedMedia: "never",
};

export const WHO_CAN_MESSAGE_OPTIONS: Array<{
  value: WhoCanMessage;
  label: string;
  description: string;
}> = [
  {
    value: "everyone",
    label: "Everyone",
    description: "Any Kristo user can message you",
  },
  {
    value: "church_members",
    label: "My church members only",
    description: "Only people who share your active church",
  },
  {
    value: "existing_conversations",
    label: "Existing conversations only",
    description: "Only people you already have a conversation with",
  },
  {
    value: "nobody",
    label: "Nobody",
    description: "No one can send you new messages",
  },
];

export const WHO_CAN_CALL_OPTIONS: Array<{
  value: WhoCanCall;
  label: string;
  description: string;
}> = [
  {
    value: "everyone",
    label: "Everyone",
    description: "Any pastoral caller allowed by Kristo",
  },
  {
    value: "church_members",
    label: "My church members only",
    description: "Only pastoral calls within your church",
  },
  {
    value: "existing_conversations",
    label: "Existing conversations only",
    description: "Only people with an existing conversation",
  },
  {
    value: "nobody",
    label: "Nobody",
    description: "Block all pastoral voice and video calls",
  },
];

export const LOCK_TIMEOUT_OPTIONS: Array<{
  value: MessageLockTimeout;
  label: string;
}> = [
  { value: "immediate", label: "Immediately" },
  { value: "1m", label: "After 1 minute" },
  { value: "5m", label: "After 5 minutes" },
  { value: "15m", label: "After 15 minutes" },
];

export const DOWNLOAD_MODE_OPTIONS: Array<{
  value: DownloadMode;
  label: string;
}> = [
  { value: "wifi_only", label: "Wi-Fi only" },
  { value: "wifi_and_cellular", label: "Wi-Fi and mobile data" },
  { value: "never", label: "Never" },
];

export const MEDIA_QUALITY_OPTIONS: Array<{
  value: MediaQuality;
  label: string;
}> = [
  { value: "high", label: "High" },
  { value: "standard", label: "Standard" },
  { value: "data_saver", label: "Data Saver" },
];

export const AUTO_DELETE_OPTIONS: Array<{
  value: AutoDeleteDownloadedMedia;
  label: string;
}> = [
  { value: "never", label: "Never" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "1y", label: "1 year" },
];

export function labelForWhoCanMessage(value: WhoCanMessage) {
  return (
    WHO_CAN_MESSAGE_OPTIONS.find((o) => o.value === value)?.label || value
  );
}

export function labelForWhoCanCall(value: WhoCanCall) {
  return WHO_CAN_CALL_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function labelForLockTimeout(value: MessageLockTimeout) {
  return LOCK_TIMEOUT_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function labelForDownloadMode(value: DownloadMode) {
  return DOWNLOAD_MODE_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function labelForMediaQuality(value: MediaQuality) {
  return MEDIA_QUALITY_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function labelForAutoDelete(value: AutoDeleteDownloadedMedia) {
  return AUTO_DELETE_OPTIONS.find((o) => o.value === value)?.label || value;
}
