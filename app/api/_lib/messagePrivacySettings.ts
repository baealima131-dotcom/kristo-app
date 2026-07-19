/**
 * User-level Message Privacy & Settings (V1).
 * Keyed by userId — never church-scoped, never exposed on public profile.
 */

export const MESSAGE_PRIVACY_SETTINGS_VERSION = 1 as const;

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

export type DownloadMode = "wifi_only" | "wifi_and_cellular" | "never";

export type MediaQuality = "high" | "standard" | "data_saver";

export type AutoDeleteDownloadedMedia = "never" | "30d" | "90d" | "1y";

export type MessagePrivacySettingsV1 = {
  version: typeof MESSAGE_PRIVACY_SETTINGS_VERSION;
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

const WHO_CAN_MESSAGE: ReadonlySet<string> = new Set([
  "everyone",
  "church_members",
  "existing_conversations",
  "nobody",
]);

const WHO_CAN_CALL: ReadonlySet<string> = new Set([
  "everyone",
  "church_members",
  "existing_conversations",
  "nobody",
]);

const DOWNLOAD_MODE: ReadonlySet<string> = new Set([
  "wifi_only",
  "wifi_and_cellular",
  "never",
]);

const MEDIA_QUALITY: ReadonlySet<string> = new Set([
  "high",
  "standard",
  "data_saver",
]);

const AUTO_DELETE: ReadonlySet<string> = new Set([
  "never",
  "30d",
  "90d",
  "1y",
]);

export function defaultMessagePrivacySettings(
  now = Date.now()
): MessagePrivacySettingsV1 {
  return {
    version: MESSAGE_PRIVACY_SETTINGS_VERSION,
    updatedAt: now,
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
    autoDownloadPhotos: true,
    autoDownloadVideos: false,
    autoDownloadAudio: false,
    autoDownloadDocuments: false,
    downloadMode: "wifi_only",
    mediaQuality: "standard",
    autoDeleteDownloadedMedia: "never",
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: T
): T {
  const raw = String(value || "").trim();
  return allowed.has(raw) ? (raw as T) : fallback;
}

export function normalizeMessagePrivacySettings(
  input?: Partial<MessagePrivacySettingsV1> | null,
  now = Date.now()
): MessagePrivacySettingsV1 {
  const base = defaultMessagePrivacySettings(now);
  const src =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  return {
    version: MESSAGE_PRIVACY_SETTINGS_VERSION,
    updatedAt:
      Number.isFinite(Number(src.updatedAt)) && Number(src.updatedAt) > 0
        ? Number(src.updatedAt)
        : base.updatedAt,
    whoCanMessage: asEnum(
      src.whoCanMessage,
      WHO_CAN_MESSAGE,
      base.whoCanMessage
    ),
    allowMessagesFromOtherChurches: asBoolean(
      src.allowMessagesFromOtherChurches,
      base.allowMessagesFromOtherChurches
    ),
    allowMessageRequests: asBoolean(
      src.allowMessageRequests,
      base.allowMessageRequests
    ),
    filterSuspiciousRequests: asBoolean(
      src.filterSuspiciousRequests,
      base.filterSuspiciousRequests
    ),
    allowVoiceCalls: asBoolean(src.allowVoiceCalls, base.allowVoiceCalls),
    allowVideoCalls: asBoolean(src.allowVideoCalls, base.allowVideoCalls),
    whoCanCall: asEnum(src.whoCanCall, WHO_CAN_CALL, base.whoCanCall),
    autoRejectUnknownCallers: asBoolean(
      src.autoRejectUnknownCallers,
      base.autoRejectUnknownCallers
    ),
    showReadReceipts: asBoolean(src.showReadReceipts, base.showReadReceipts),
    showOnlineStatus: asBoolean(src.showOnlineStatus, base.showOnlineStatus),
    showLastActive: asBoolean(src.showLastActive, base.showLastActive),
    showTypingIndicator: asBoolean(
      src.showTypingIndicator,
      base.showTypingIndicator
    ),
    showMessagePreviews: asBoolean(
      src.showMessagePreviews,
      base.showMessagePreviews
    ),
    showSenderNameInNotifications: asBoolean(
      src.showSenderNameInNotifications,
      base.showSenderNameInNotifications
    ),
    muteAllMessageNotifications: asBoolean(
      src.muteAllMessageNotifications,
      base.muteAllMessageNotifications
    ),
    privateCallNotifications: asBoolean(
      src.privateCallNotifications,
      base.privateCallNotifications
    ),
    autoDownloadPhotos: asBoolean(
      src.autoDownloadPhotos,
      base.autoDownloadPhotos
    ),
    autoDownloadVideos: asBoolean(
      src.autoDownloadVideos,
      base.autoDownloadVideos
    ),
    autoDownloadAudio: asBoolean(src.autoDownloadAudio, base.autoDownloadAudio),
    autoDownloadDocuments: asBoolean(
      src.autoDownloadDocuments,
      base.autoDownloadDocuments
    ),
    downloadMode: asEnum(src.downloadMode, DOWNLOAD_MODE, base.downloadMode),
    mediaQuality: asEnum(src.mediaQuality, MEDIA_QUALITY, base.mediaQuality),
    autoDeleteDownloadedMedia: asEnum(
      src.autoDeleteDownloadedMedia,
      AUTO_DELETE,
      base.autoDeleteDownloadedMedia
    ),
  };
}

export type MessagePrivacyValidationError = {
  field: string;
  message: string;
};

/** Strict patch validation — rejects unknown keys and invalid enum/boolean values. */
export function validateMessagePrivacySettingsPatch(
  patch: unknown
): {
  ok: true;
  patch: MessagePrivacySettingsPatch;
} | {
  ok: false;
  errors: MessagePrivacyValidationError[];
} {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return {
      ok: false,
      errors: [{ field: "body", message: "Expected a settings object." }],
    };
  }

  // Reject prototype-pollution style payloads before reading fields.
  const proto = Object.getPrototypeOf(patch);
  if (proto !== Object.prototype && proto !== null) {
    return {
      ok: false,
      errors: [{ field: "body", message: "Expected a plain settings object." }],
    };
  }

  const src = patch as Record<string, unknown>;
  const errors: MessagePrivacyValidationError[] = [];
  const out: MessagePrivacySettingsPatch = Object.create(null);

  const dangerousKeys = new Set([
    "__proto__",
    "constructor",
    "prototype",
  ]);

  const booleanFields: Array<keyof MessagePrivacySettingsPatch> = [
    "allowMessagesFromOtherChurches",
    "allowMessageRequests",
    "filterSuspiciousRequests",
    "allowVoiceCalls",
    "allowVideoCalls",
    "autoRejectUnknownCallers",
    "showReadReceipts",
    "showOnlineStatus",
    "showLastActive",
    "showTypingIndicator",
    "showMessagePreviews",
    "showSenderNameInNotifications",
    "muteAllMessageNotifications",
    "privateCallNotifications",
    "autoDownloadPhotos",
    "autoDownloadVideos",
    "autoDownloadAudio",
    "autoDownloadDocuments",
  ];

  const enumFields: Array<{
    key: keyof MessagePrivacySettingsPatch;
    allowed: ReadonlySet<string>;
  }> = [
    { key: "whoCanMessage", allowed: WHO_CAN_MESSAGE },
    { key: "whoCanCall", allowed: WHO_CAN_CALL },
    { key: "downloadMode", allowed: DOWNLOAD_MODE },
    { key: "mediaQuality", allowed: MEDIA_QUALITY },
    { key: "autoDeleteDownloadedMedia", allowed: AUTO_DELETE },
  ];

  const allowedKeys = new Set<string>([
    ...booleanFields,
    ...enumFields.map((f) => f.key),
  ]);

  for (const key of Object.keys(src)) {
    if (dangerousKeys.has(key)) {
      errors.push({
        field: key,
        message: `Forbidden setting key: ${key}`,
      });
      continue;
    }
    if (key === "version" || key === "updatedAt") continue;
    if (!allowedKeys.has(key)) {
      errors.push({ field: key, message: `Unknown setting: ${key}` });
    }
  }

  for (const key of booleanFields) {
    if (!(key in src)) continue;
    if (typeof src[key] !== "boolean") {
      errors.push({ field: key, message: `${key} must be a boolean.` });
      continue;
    }
    (out as any)[key] = src[key];
  }

  for (const { key, allowed } of enumFields) {
    if (!(key in src)) continue;
    const raw = String(src[key] ?? "").trim();
    if (!allowed.has(raw)) {
      errors.push({
        field: key,
        message: `${key} must be one of: ${Array.from(allowed).join(", ")}.`,
      });
      continue;
    }
    (out as any)[key] = raw;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, patch: { ...out } as MessagePrivacySettingsPatch };
}

export function mergeMessagePrivacySettings(
  current: MessagePrivacySettingsV1,
  patch: MessagePrivacySettingsPatch,
  now = Date.now()
): MessagePrivacySettingsV1 {
  return normalizeMessagePrivacySettings(
    {
      ...current,
      ...patch,
      version: MESSAGE_PRIVACY_SETTINGS_VERSION,
      updatedAt: now,
    },
    now
  );
}

export type MessagePrivacyDenyReason =
  | "nobody"
  | "church_members_only"
  | "existing_conversations_only"
  | "other_churches_disabled"
  | "message_requests_disabled"
  | "suspicious_filtered"
  | "voice_calls_disabled"
  | "video_calls_disabled"
  | "call_nobody"
  | "call_church_members_only"
  | "call_existing_conversations_only"
  | "unknown_caller_rejected";

export type RecipientMessageGateInput = {
  settings: MessagePrivacySettingsV1;
  shareActiveChurch: boolean;
  /** True when a durable DM thread already exists for the pair. */
  hasExistingConversation: boolean;
  /** True when relationship is accepted or same_church (unlimited). */
  isEstablishedConversation: boolean;
  /** True when this send/open would create or continue a cross-church request. */
  isCrossChurchRequest: boolean;
  /** Outbound request count for spam heuristic when filter is on. */
  initiatorOutboundCount?: number;
};

export type RecipientMessageGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: MessagePrivacyDenyReason;
      error: string;
      code: string;
    };

/**
 * Evaluate whether the *recipient* allows inbound messaging from this sender.
 * Block is handled separately and always wins.
 */
export function evaluateRecipientMessagePrivacy(
  input: RecipientMessageGateInput
): RecipientMessageGateResult {
  const { settings } = input;

  if (settings.whoCanMessage === "nobody") {
    return {
      ok: false,
      reason: "nobody",
      code: "DM_PRIVACY_NOBODY",
      error: "This person is not accepting new messages.",
    };
  }

  if (settings.whoCanMessage === "church_members") {
    if (!input.shareActiveChurch) {
      return {
        ok: false,
        reason: "church_members_only",
        code: "DM_PRIVACY_CHURCH_MEMBERS",
        error: "This person only accepts messages from church members.",
      };
    }
  }

  if (settings.whoCanMessage === "existing_conversations") {
    if (!input.hasExistingConversation) {
      return {
        ok: false,
        reason: "existing_conversations_only",
        code: "DM_PRIVACY_EXISTING_ONLY",
        error: "This person only accepts messages in existing conversations.",
      };
    }
  }

  if (
    !input.shareActiveChurch &&
    !settings.allowMessagesFromOtherChurches &&
    !input.isEstablishedConversation
  ) {
    return {
      ok: false,
      reason: "other_churches_disabled",
      code: "DM_PRIVACY_OTHER_CHURCHES",
      error: "This person does not accept messages from other churches.",
    };
  }

  if (
    input.isCrossChurchRequest &&
    !input.isEstablishedConversation &&
    !settings.allowMessageRequests
  ) {
    return {
      ok: false,
      reason: "message_requests_disabled",
      code: "DM_PRIVACY_REQUESTS_DISABLED",
      error: "This person is not accepting message requests.",
    };
  }

  // Soft spam heuristic: when filter is on, reject new cross-church requests
  // once the initiator has already burned the full outbound quota without accept.
  if (
    settings.filterSuspiciousRequests &&
    input.isCrossChurchRequest &&
    !input.isEstablishedConversation &&
    Number(input.initiatorOutboundCount || 0) >= 5
  ) {
    return {
      ok: false,
      reason: "suspicious_filtered",
      code: "DM_PRIVACY_SUSPICIOUS_FILTERED",
      error: "This message request was filtered as suspicious.",
    };
  }

  return { ok: true };
}

export type RecipientCallGateInput = {
  settings: MessagePrivacySettingsV1;
  shareActiveChurch: boolean;
  hasExistingConversation: boolean;
  callKind: "voice" | "video";
  /** True when caller has no prior DM thread with receiver. */
  isUnknownCaller: boolean;
};

export type RecipientCallGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: MessagePrivacyDenyReason;
      error: string;
      code: string;
      /** When true, create session as auto-declined instead of hard 403. */
      autoReject?: boolean;
    };

/** Pastoral-call model only — caller must already pass pastor↔member checks. */
export function evaluateRecipientCallPrivacy(
  input: RecipientCallGateInput
): RecipientCallGateResult {
  const { settings } = input;

  if (input.callKind === "voice" && !settings.allowVoiceCalls) {
    return {
      ok: false,
      reason: "voice_calls_disabled",
      code: "CALL_PRIVACY_VOICE_DISABLED",
      error: "This person is not accepting voice calls.",
    };
  }

  if (input.callKind === "video" && !settings.allowVideoCalls) {
    return {
      ok: false,
      reason: "video_calls_disabled",
      code: "CALL_PRIVACY_VIDEO_DISABLED",
      error: "This person is not accepting video calls.",
    };
  }

  if (settings.whoCanCall === "nobody") {
    return {
      ok: false,
      reason: "call_nobody",
      code: "CALL_PRIVACY_NOBODY",
      error: "This person is not accepting calls.",
    };
  }

  if (settings.whoCanCall === "church_members" && !input.shareActiveChurch) {
    return {
      ok: false,
      reason: "call_church_members_only",
      code: "CALL_PRIVACY_CHURCH_MEMBERS",
      error: "This person only accepts calls from church members.",
    };
  }

  if (
    settings.whoCanCall === "existing_conversations" &&
    !input.hasExistingConversation
  ) {
    return {
      ok: false,
      reason: "call_existing_conversations_only",
      code: "CALL_PRIVACY_EXISTING_ONLY",
      error: "This person only accepts calls from existing conversations.",
    };
  }

  if (settings.autoRejectUnknownCallers && input.isUnknownCaller) {
    return {
      ok: false,
      reason: "unknown_caller_rejected",
      code: "CALL_PRIVACY_UNKNOWN_REJECTED",
      error: "Unknown callers are automatically rejected.",
      autoReject: true,
    };
  }

  return { ok: true };
}

/** Both sides must allow receipts for the peer to see "Read". */
export function shouldExposeReadReceipt(args: {
  viewerShowsReceipts: boolean;
  peerShowsReceipts: boolean;
}): boolean {
  return args.viewerShowsReceipts && args.peerShowsReceipts;
}

export function redactPresenceForPrivacy(args: {
  settings: MessagePrivacySettingsV1;
  online: boolean;
  lastSeenAt: number;
  text: string;
}): {
  online: boolean;
  lastSeenAt: number | null;
  text: string;
  presenceHidden: boolean;
} {
  const showOnline = args.settings.showOnlineStatus;
  const showLast = args.settings.showLastActive;

  if (!showOnline && !showLast) {
    return {
      online: false,
      lastSeenAt: null,
      text: "",
      presenceHidden: true,
    };
  }

  if (args.online && showOnline) {
    return {
      online: true,
      lastSeenAt: showLast ? args.lastSeenAt : null,
      text: "online now",
      presenceHidden: false,
    };
  }

  if (!showLast) {
    return {
      online: false,
      lastSeenAt: null,
      text: showOnline ? "offline" : "",
      presenceHidden: !showOnline,
    };
  }

  return {
    online: false,
    lastSeenAt: args.lastSeenAt,
    text: args.text,
    presenceHidden: false,
  };
}
