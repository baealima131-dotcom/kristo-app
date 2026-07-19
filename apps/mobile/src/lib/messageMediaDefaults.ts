import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_MESSAGE_PRIVACY_SETTINGS,
  type MessagePrivacySettingsV1,
} from "@/src/lib/messagePrivacySettingsTypes";

const CACHE_KEY = "kristo_message_media_defaults_v1";

export type MessageMediaDefaults = Pick<
  MessagePrivacySettingsV1,
  | "autoDownloadPhotos"
  | "autoDownloadVideos"
  | "autoDownloadAudio"
  | "autoDownloadDocuments"
  | "downloadMode"
  | "mediaQuality"
  | "autoDeleteDownloadedMedia"
>;

export function mediaDefaultsFromSettings(
  settings: MessagePrivacySettingsV1
): MessageMediaDefaults {
  return {
    autoDownloadPhotos: settings.autoDownloadPhotos,
    autoDownloadVideos: settings.autoDownloadVideos,
    autoDownloadAudio: settings.autoDownloadAudio,
    autoDownloadDocuments: settings.autoDownloadDocuments,
    downloadMode: settings.downloadMode,
    mediaQuality: settings.mediaQuality,
    autoDeleteDownloadedMedia: settings.autoDeleteDownloadedMedia,
  };
}

export async function cacheMessageMediaDefaults(
  settings: MessagePrivacySettingsV1
): Promise<void> {
  const defaults = mediaDefaultsFromSettings(settings);
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(defaults));
}

export async function loadCachedMessageMediaDefaults(): Promise<MessageMediaDefaults> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) {
      return mediaDefaultsFromSettings(DEFAULT_MESSAGE_PRIVACY_SETTINGS);
    }
    const parsed = JSON.parse(raw);
    return {
      ...mediaDefaultsFromSettings(DEFAULT_MESSAGE_PRIVACY_SETTINGS),
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    return mediaDefaultsFromSettings(DEFAULT_MESSAGE_PRIVACY_SETTINGS);
  }
}

/** Whether a MIME/type should auto-download under current defaults. */
export function shouldAutoDownloadAttachment(args: {
  defaults: MessageMediaDefaults;
  mime?: string;
  kind?: string;
  isWifi?: boolean;
}): boolean {
  const { defaults } = args;
  if (defaults.downloadMode === "never") return false;
  if (defaults.downloadMode === "wifi_only" && args.isWifi === false) {
    return false;
  }

  const mime = String(args.mime || "").toLowerCase();
  const kind = String(args.kind || "").toLowerCase();

  const isPhoto =
    mime.startsWith("image/") || kind === "image" || kind === "photo";
  const isVideo = mime.startsWith("video/") || kind === "video";
  const isAudio = mime.startsWith("audio/") || kind === "audio";
  const isDocument =
    !isPhoto &&
    !isVideo &&
    !isAudio &&
    (mime.startsWith("application/") ||
      kind === "document" ||
      kind === "file");

  if (isPhoto) return defaults.autoDownloadPhotos;
  if (isVideo) return defaults.autoDownloadVideos;
  if (isAudio) return defaults.autoDownloadAudio;
  if (isDocument) return defaults.autoDownloadDocuments;
  return false;
}
