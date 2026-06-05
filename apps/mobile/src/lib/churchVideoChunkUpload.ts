import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost } from "@/src/lib/kristoApi";
import type { SignedMediaUploadSession } from "@/src/lib/churchVideoUpload";

type HeadersRec = Record<string, string>;

export const CHUNK_SESSION_STORAGE_KEY = "kristo_media_chunk_sessions_v1";
export const VIDEO_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
/** Prefer one multipart part for small files to avoid slow 2-part uploads. */
export const SINGLE_PART_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const UPLOAD_PART_TIMEOUT_MS = 240_000;
export const COMPLETE_TIMEOUT_MS = 120_000;
export const UPLOAD_PART_MAX_ATTEMPTS = 2;
export const MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE =
  "Resumable upload backend not deployed yet.";

function isStallError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export class MultipartBackendNotDeployedError extends Error {
  constructor(message = MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE) {
    super(message);
    this.name = "MultipartBackendNotDeployedError";
  }
}

function assertMultipartApiAvailable(res: any, endpoint: string) {
  if (Number(res?.status) === 404) {
    console.log("KRISTO_MULTIPART_BACKEND_NOT_DEPLOYED", { endpoint, status: 404 });
    throw new MultipartBackendNotDeployedError();
  }
}

export type ChunkUploadPartRecord = {
  partNumber: number;
  etag: string;
};

export type PersistedChunkUploadSession = {
  sessionId: string;
  uploadId: string;
  key: string;
  publicUrl: string;
  videoUrl: string;
  contentType: string;
  fileUri: string;
  fileSize: number;
  chunkSize: number;
  totalParts: number;
  completedParts: ChunkUploadPartRecord[];
  createdAt: string;
  updatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

async function readChunkSessions(): Promise<PersistedChunkUploadSession[]> {
  try {
    const raw = await AsyncStorage.getItem(CHUNK_SESSION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeChunkSessions(sessions: PersistedChunkUploadSession[]) {
  await AsyncStorage.setItem(CHUNK_SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

export async function getChunkUploadSession(sessionId: string) {
  const sessions = await readChunkSessions();
  return sessions.find((row) => row.sessionId === sessionId) || null;
}

export async function upsertChunkUploadSession(session: PersistedChunkUploadSession) {
  const sessions = await readChunkSessions();
  const index = sessions.findIndex((row) => row.sessionId === session.sessionId);
  const next = { ...session, updatedAt: nowIso() };
  if (index >= 0) sessions[index] = next;
  else sessions.unshift(next);
  await writeChunkSessions(sessions);
  return next;
}

export async function removeChunkUploadSession(sessionId: string) {
  const sessions = await readChunkSessions();
  const next = sessions.filter((row) => row.sessionId !== sessionId);
  if (next.length === sessions.length) return;
  await writeChunkSessions(next);
}

function chunkProgress(completedParts: number, totalParts: number) {
  if (!totalParts) return 0;
  return Math.min(99, Math.round((completedParts / totalParts) * 100));
}

async function readFileChunkBase64(fileUri: string, position: number, length: number) {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  } as any);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function uploadChunkPart(params: {
  uploadUrl: string;
  fileUri: string;
  start: number;
  length: number;
  timeoutMs: number;
}) {
  const base64 = await readFileChunkBase64(params.fileUri, params.start, params.length);
  const body = base64ToArrayBuffer(base64);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(params.uploadUrl, {
      method: "PUT",
      body,
      headers: {
        "Content-Type": "application/octet-stream",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chunk upload failed (${response.status || "unknown"}).`);
    }

    const etag = String(response.headers.get("ETag") || response.headers.get("etag") || "")
      .trim()
      .replace(/^"+|"+$/g, "");

    if (!etag) {
      throw new Error("Chunk upload succeeded but ETag was missing.");
    }

    return etag;
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw new Error(`Chunk upload timed out after ${params.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function uploadChunkPartWithRetry(params: {
  uploadUrl: string;
  fileUri: string;
  start: number;
  length: number;
  timeoutMs: number;
  partNumber: number;
  sessionId: string;
}) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= UPLOAD_PART_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await uploadChunkPart(params);
    } catch (error) {
      lastError = error;
      if (attempt >= UPLOAD_PART_MAX_ATTEMPTS) break;
      console.log("KRISTO_UPLOAD_PART_RETRY", {
        sessionId: params.sessionId,
        partNumber: params.partNumber,
        attempt,
        retryable: isStallError(error),
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Chunk upload failed after retry.");
}

function preferSinglePartUpload(fileSize: number) {
  return fileSize > 0 && fileSize < SINGLE_PART_UPLOAD_MAX_BYTES;
}

function normalizeChunkSessionForFileSize(
  session: PersistedChunkUploadSession,
  fileSize: number
): PersistedChunkUploadSession {
  if (!preferSinglePartUpload(fileSize)) return session;
  return {
    ...session,
    fileSize,
    chunkSize: fileSize,
    totalParts: 1,
  };
}

async function initMultipartSession(params: {
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
}) {
  const res: any = await apiPost(
    "/api/church/media/upload-multipart/init",
    {
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
    },
    { headers: params.headers }
  );

  assertMultipartApiAvailable(res, "/api/church/media/upload-multipart/init");

  if (!res?.ok) {
    throw new Error(String(res?.error || "Could not start multipart upload."));
  }

  return res?.data || res;
}

async function requestPartUploadUrl(params: {
  key: string;
  uploadId: string;
  partNumber: number;
  contentLength: number;
  headers: HeadersRec;
}) {
  const res: any = await apiPost(
    "/api/church/media/upload-multipart/part-url",
    {
      key: params.key,
      uploadId: params.uploadId,
      partNumber: params.partNumber,
      contentLength: params.contentLength,
    },
    { headers: params.headers }
  );

  assertMultipartApiAvailable(res, "/api/church/media/upload-multipart/part-url");

  if (!res?.ok) {
    throw new Error(String(res?.error || "Could not create chunk upload URL."));
  }

  return res?.data || res;
}

async function completeMultipartSession(params: {
  key: string;
  uploadId: string;
  parts: ChunkUploadPartRecord[];
  headers: HeadersRec;
}) {
  const res: any = await apiPost(
    "/api/church/media/upload-multipart/complete",
    {
      key: params.key,
      uploadId: params.uploadId,
      parts: params.parts,
    },
    { headers: params.headers }
  );

  assertMultipartApiAvailable(res, "/api/church/media/upload-multipart/complete");

  if (!res?.ok) {
    throw new Error(String(res?.error || "Could not finalize multipart upload."));
  }

  return res?.data || res;
}

async function completeMultipartSessionWithRetry(params: {
  key: string;
  uploadId: string;
  parts: ChunkUploadPartRecord[];
  headers: HeadersRec;
  sessionId: string;
  timeoutMs: number;
}) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await withTimeout(
        completeMultipartSession({
          key: params.key,
          uploadId: params.uploadId,
          parts: params.parts,
          headers: params.headers,
        }),
        params.timeoutMs,
        "Multipart complete"
      );
    } catch (error) {
      const shouldRetry = attempt < 2 && isStallError(error);
      if (!shouldRetry) throw error;
      console.log("KRISTO_UPLOAD_COMPLETE_TIMEOUT_RETRY", {
        jobId: params.sessionId,
        attempt,
      });
    }
  }
  throw new Error("Multipart complete failed after retry.");
}

export async function uploadVideoWithChunkSession(params: {
  sessionId: string;
  fileUri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
  existingSession?: PersistedChunkUploadSession | null;
  onProgress?: (percent: number) => void;
  timeoutMs?: number;
}): Promise<SignedMediaUploadSession & { resumableMode: "chunk"; sessionId: string }> {
  const timeoutMs = params.timeoutMs ?? UPLOAD_PART_TIMEOUT_MS;
  let session =
    params.existingSession ||
    (await getChunkUploadSession(params.sessionId));

  if (!session) {
    const init = await initMultipartSession({
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
      headers: params.headers,
    });

    session = normalizeChunkSessionForFileSize(
      {
        sessionId: params.sessionId,
        uploadId: String(init.uploadId || "").trim(),
        key: String(init.key || "").trim(),
        publicUrl: String(init.publicUrl || init.videoUrl || "").trim(),
        videoUrl: String(init.videoUrl || init.publicUrl || "").trim(),
        contentType: String(init.contentType || params.contentType).trim(),
        fileUri: params.fileUri,
        fileSize: params.fileSize,
        chunkSize: Number(init.chunkSize || VIDEO_CHUNK_SIZE_BYTES),
        totalParts: Number(init.totalParts || 1),
        completedParts: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      params.fileSize
    );

    await upsertChunkUploadSession(session);
    console.log("KRISTO_CHUNK_UPLOAD_SESSION_CREATED", {
      sessionId: session.sessionId,
      totalParts: session.totalParts,
      chunkSize: session.chunkSize,
    });
  }

  const completedMap = new Map<number, string>(
    (session.completedParts || []).map((part) => [part.partNumber, part.etag])
  );

  for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
    if (completedMap.has(partNumber)) {
      params.onProgress?.(chunkProgress(completedMap.size, session.totalParts));
      continue;
    }

    const start = (partNumber - 1) * session.chunkSize;
    const remaining = Math.max(0, session.fileSize - start);
    const length = Math.min(session.chunkSize, remaining);
    if (length <= 0) continue;

    const signedPart = await requestPartUploadUrl({
      key: session.key,
      uploadId: session.uploadId,
      partNumber,
      contentLength: length,
      headers: params.headers,
    });

    const etag = await uploadChunkPartWithRetry({
      uploadUrl: String(signedPart.uploadUrl || "").trim(),
      fileUri: session.fileUri,
      start,
      length,
      timeoutMs,
      partNumber,
      sessionId: session.sessionId,
    });

    completedMap.set(partNumber, etag);
    session = {
      ...session,
      completedParts: Array.from(completedMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([partNumberValue, etagValue]) => ({
          partNumber: partNumberValue,
          etag: etagValue,
        })),
    };
    await upsertChunkUploadSession(session);

    console.log("KRISTO_CHUNK_UPLOAD_PART_DONE", {
      sessionId: session.sessionId,
      partNumber,
      completedParts: session.completedParts.length,
      totalParts: session.totalParts,
    });

    params.onProgress?.(chunkProgress(session.completedParts.length, session.totalParts));
  }

  const completed = await completeMultipartSessionWithRetry({
    key: session.key,
    uploadId: session.uploadId,
    parts: session.completedParts,
    headers: params.headers,
    sessionId: session.sessionId,
    timeoutMs: COMPLETE_TIMEOUT_MS,
  });

  await removeChunkUploadSession(session.sessionId);

  const publicUrl = String(completed.publicUrl || completed.videoUrl || session.publicUrl).trim();

  console.log("KRISTO_CHUNK_UPLOAD_COMPLETE", {
    sessionId: session.sessionId,
    videoUrl: publicUrl,
    partCount: session.completedParts.length,
  });

  const faststart = completed.faststart === true;

  const faststartPending = completed.faststartPending === true;
  const faststartReason = String(completed.faststartReason || "").trim() || null;
  const posterUri = String(completed.posterUri || "").trim() || null;
  const brandedPoster = completed.brandedPoster === true;

  if (faststart) {
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_DONE", {
      videoUrl: publicUrl,
      posterUri,
    });
  } else {
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl: publicUrl,
      faststartPending,
      faststartReason,
      posterUri,
    });
    console.log("KRISTO_VIDEO_FASTSTART_REQUIRED", {
      videoUrl: publicUrl,
      faststart: false,
      faststartPending,
      faststartReason,
    });
  }

  return {
    uploadUrl: "",
    videoUrl: publicUrl,
    publicUrl,
    contentType: session.contentType,
    faststart,
    faststartPending,
    faststartReason,
    posterUri,
    brandedPoster,
    resumableMode: "chunk",
    sessionId: session.sessionId,
  };
}

export function chunkSessionResumeProgress(session: PersistedChunkUploadSession | null | undefined) {
  if (!session) return 0;
  return chunkProgress(session.completedParts?.length || 0, session.totalParts || 1);
}

export function chunkSessionUploadedIndexes(session: PersistedChunkUploadSession | null | undefined) {
  return (session?.completedParts || []).map((part) => part.partNumber);
}
