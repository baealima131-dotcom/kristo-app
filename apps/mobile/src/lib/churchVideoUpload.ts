import { apiPost } from "@/src/lib/kristoApi";

type HeadersRec = Record<string, string>;

export type SignedVideoUploadSession = {
  uploadUrl: string;
  videoUrl: string;
  contentType: string;
};

function uploadErrorMessage(body: any, fallback: string) {
  return String(body?.error || body?.message || fallback).trim() || fallback;
}

export function guessVideoContentType(fileName: string) {
  const lower = String(fileName || "").trim().toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}

export function fileNameFromUri(uri: string, fallback = "video.mp4") {
  const clean = String(uri || "").trim().split("?")[0];
  const base = clean.split("/").pop();
  if (base && base.includes(".")) return base;
  return fallback;
}

export async function requestVideoUploadUrl(params: {
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
}): Promise<SignedVideoUploadSession> {
  const res: any = await apiPost(
    "/api/church/media/upload-url",
    {
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
    },
    { headers: params.headers }
  );

  if (!res?.ok) {
    throw new Error(uploadErrorMessage(res, "Could not start video upload."));
  }

  const data = res?.data || res;
  const uploadUrl = String(data?.uploadUrl || "").trim();
  const videoUrl = String(data?.videoUrl || "").trim();
  const contentType = String(data?.contentType || params.contentType || "video/mp4").trim();

  if (!uploadUrl || !videoUrl) {
    throw new Error("Signed upload URL response was incomplete.");
  }

  return { uploadUrl, videoUrl, contentType };
}

export async function uploadVideoFileToSignedUrl(params: {
  fileUri: string;
  uploadUrl: string;
  contentType: string;
  onProgress?: (percent: number) => void;
}) {
  const FileSystem = await import("expo-file-system/legacy");

  const progressCallback = params.onProgress
    ? (event: { totalBytesSent?: number; totalBytesExpectedToSend?: number }) => {
        const sent = Number(event?.totalBytesSent || 0);
        const expected = Number(event?.totalBytesExpectedToSend || 0);
        if (!expected) return;
        const pct = Math.min(99, Math.round((sent / expected) * 100));
        params.onProgress?.(pct);
      }
    : undefined;

  const task = FileSystem.createUploadTask(
    params.uploadUrl,
    params.fileUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        "Content-Type": params.contentType,
      },
    },
    progressCallback
  );

  const result = await task.uploadAsync();
  const status = Number(result?.status || 0);

  if (status < 200 || status >= 300) {
    throw new Error(`Video storage upload failed (${status || "unknown"}).`);
  }

  params.onProgress?.(100);
}

export async function publishChurchVideoFeedPost(params: {
  title: string;
  caption: string;
  videoUrl: string;
  headers: HeadersRec;
}) {
  const res: any = await apiPost(
    "/api/church/feed",
    {
      type: "video",
      mediaType: "video",
      title: params.title,
      text: params.caption,
      videoUrl: params.videoUrl,
    },
    { headers: params.headers }
  );

  if (!res?.ok) {
    throw new Error(uploadErrorMessage(res, "Could not publish video to feed."));
  }

  return res;
}
