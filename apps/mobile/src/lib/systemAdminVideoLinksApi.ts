import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { resolveUploadFileSize, uploadFileToSignedUrlWithRetry } from "@/src/lib/churchVideoUpload";

export type SystemAdminVideoMetadata = {
  provider: "youtube" | "tiktok" | "facebook";
  videoId: string;
  url: string;
  title: string;
  creatorName: string;
  creatorId?: string | null;
  creatorProfileUrl: string | null;
  detectedLanguageCode?: string;
  creatorAvatarUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  stats: {
    views: number | null;
    likes: number | null;
    comments: number | null;
  };
  unavailableFields?: string[];
  /** Facebook: the link as pasted (opened by "Fungua Facebook") and the video's shape. */
  originalUrl?: string;
  orientation?: "vertical" | "landscape";
};

export async function fetchSystemAdminVideoMetadata(url: string): Promise<SystemAdminVideoMetadata> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/metadata",
    { url },
    { headers: getKristoHeaders() as any }
  );

  if (!response || response.ok !== true || !response.metadata) {
    throw new Error(String(response?.error || "Taarifa za video hazikupatikana."));
  }
  return response.metadata as SystemAdminVideoMetadata;
}

export type SavedSystemAdminVideoLink = {
  id: string;
  hidden: boolean;
  provider: "youtube" | "tiktok" | "facebook";
  url: string;
  title: string;
  creatorId: string;
  creatorName: string;
  creatorProfileUrl: string;
  creatorAvatarUrl: string;
  thumbnailUrl: string;
  publishedAt: string;
  createdAt: string;
  countryCode: string;
  countryName: string;
  languageCode: string;
  languageName: string;
  stats: { views?: number | null; likes?: number | null; comments?: number | null };
  /** Facebook only: counts a System Admin read on Facebook, and when they were checked. */
  manualStats?: FacebookManualStats | null;
  /** Facebook only: "vertical" for Reels. */
  orientation?: string;
  /** Facebook only: optional cover uploaded by a System Admin (blurred beside Reels in Watch). */
  coverUrl?: string;
};

export type FacebookManualStats = { likes: number | null; comments: number | null; checkedAt: string };
/** Admin input as typed; an empty string means "not entered". */
export type FacebookManualStatsInput = { likes: string; comments: string };

/** Mirrors the server rule: digits, optionally grouped with spaces, commas or dots; or empty. */
export function isValidManualCountInput(value: string): boolean {
  const text = String(value || "").trim();
  return !text || /^\d{1,3}([ ,.]?\d{3})*$|^\d+$/.test(text);
}

export async function updateFacebookManualStats(
  id: string,
  manualStats: FacebookManualStatsInput
): Promise<FacebookManualStats | null> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/metadata",
    { action: "facebook-manual-stats", id, manualStats },
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true) {
    throw new Error(String(response?.error || "Hesabu za Facebook hazikuhifadhiwa."));
  }
  return (response.manualStats as FacebookManualStats | null) ?? null;
}

export async function fetchSavedSystemAdminVideoLinks(): Promise<SavedSystemAdminVideoLink[]> {
  const response: any = await apiGet(
    "/api/system-admin/video-links/metadata",
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true || !Array.isArray(response.items)) {
    throw new Error(String(response?.error || "Video zilizohifadhiwa hazikupatikana."));
  }
  return response.items as SavedSystemAdminVideoLink[];
}

export async function setSystemAdminVideoLinkHidden(id: string, hidden: boolean): Promise<void> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/metadata",
    { action: "hide", id, hidden },
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true || response.hidden !== hidden) {
    throw new Error(String(response?.error || "Hali ya video haikubadilishwa."));
  }
}

export async function deleteSystemAdminVideoLink(id: string): Promise<void> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/metadata",
    { action: "delete", id },
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true || response.deleted !== true) {
    throw new Error(String(response?.error || "Video haikuondolewa kwenye Home Feed."));
  }
}

export async function publishSystemAdminVideoLink(
  url: string,
  country: { code: string; name: string },
  language: { code: string; name: string },
  manualStats?: FacebookManualStatsInput,
  facebookCoverUrl?: string
): Promise<{ feedItemId: string }> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/metadata",
    {
      action: "publish",
      url,
      countryCode: country.code,
      countryName: country.name,
      languageCode: language.code,
      languageName: language.name,
      ...(manualStats ? { manualStats } : {}),
      ...(facebookCoverUrl ? { facebookCoverUrl } : {}),
    },
    { headers: getKristoHeaders() as any }
  );

  if (!response || response.ok !== true || response.published !== true || !response.feedItemId) {
    throw new Error(String(response?.error || "Video haikuongezwa kwenye Home Feed."));
  }
  return { feedItemId: String(response.feedItemId) };
}

/**
 * Upload a cover image for a Facebook link to Kristo's poster storage through a signed URL the
 * System Admin route issues. Returns the stored image's public URL.
 */
export async function uploadFacebookCoverImage(localUri: string): Promise<string> {
  const fileSize = await resolveUploadFileSize(localUri);
  if (!(fileSize > 0)) throw new Error("Picha ya cover haikusomeka.");
  const contentType = "image/jpeg";
  const session = await uploadFileToSignedUrlWithRetry({
    fileUri: localUri,
    contentType,
    label: "poster",
    maxRetries: 2,
    resolveUploadSession: async () => {
      const response: any = await apiPost(
        "/api/system-admin/video-links/metadata",
        { action: "facebook-cover-upload-url", fileName: `facebook-cover-${Date.now()}.jpg`, contentType, fileSize },
        { headers: getKristoHeaders() as any }
      );
      if (!response || response.ok !== true || !response.uploadUrl || !response.publicUrl) {
        throw new Error(String(response?.error || "Upload ya cover haikuweza kuanza."));
      }
      return {
        uploadUrl: String(response.uploadUrl),
        publicUrl: String(response.publicUrl),
        videoUrl: String(response.publicUrl),
        contentType: String(response.contentType || contentType),
      };
    },
  });
  const url = String(session.publicUrl || "").trim();
  if (!url) throw new Error("Cover haikuhifadhiwa.");
  return url;
}

/** Set (or clear with null) the cover of a saved Facebook link. */
export async function setFacebookCover(id: string, coverUrl: string | null): Promise<string | null> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/metadata",
    { action: "facebook-cover", id, coverUrl },
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true) {
    throw new Error(String(response?.error || "Cover haikuhifadhiwa."));
  }
  return response.coverUrl ? String(response.coverUrl) : null;
}
