import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export type SystemAdminVideoMetadata = {
  provider: "youtube" | "tiktok";
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
  provider: "youtube" | "tiktok";
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
};

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
  language: { code: string; name: string }
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
    },
    { headers: getKristoHeaders() as any }
  );

  if (!response || response.ok !== true || response.published !== true || !response.feedItemId) {
    throw new Error(String(response?.error || "Video haikuongezwa kwenye Home Feed."));
  }
  return { feedItemId: String(response.feedItemId) };
}

export async function fetchConnectedYoutubeChannelIds(): Promise<string[]> {
  const response: any = await apiGet(
    "/api/system-admin/video-links/youtube-analytics",
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true || !Array.isArray(response.connectedChannelIds)) {
    throw new Error(String(response?.error || "Hali ya channel za YouTube haikupatikana."));
  }
  return response.connectedChannelIds.map((id: unknown) => String(id || "")).filter(Boolean);
}

export async function createYoutubeAnalyticsInvite(videoItemId: string): Promise<{ connectUrl: string; creatorName: string }> {
  const response: any = await apiPost(
    "/api/system-admin/video-links/youtube-analytics",
    { videoItemId },
    { headers: getKristoHeaders() as any }
  );
  if (!response || response.ok !== true || !response.connectUrl) {
    throw new Error(String(response?.error || "Link ya mwaliko haikutengenezwa."));
  }
  return {
    connectUrl: String(response.connectUrl),
    creatorName: String(response.creatorName || "YouTube channel"),
  };
}
