import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export type SystemAdminVideoMetadata = {
  provider: "youtube" | "tiktok";
  videoId: string;
  url: string;
  title: string;
  creatorName: string;
  creatorProfileUrl: string | null;
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
