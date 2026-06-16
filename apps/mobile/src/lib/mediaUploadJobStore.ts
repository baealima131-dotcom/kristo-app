import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeMediaStatus } from "@/src/lib/mediaStatus";

export type MediaUploadJobPhase =
  | "preparing"
  | "optimizing"
  | "uploading"
  | "finalizing"
  | "paused"
  | "processing"
  | "ready"
  | "failed";

export type MediaUploadResumableMode = "chunk" | "v1-restart";

export type PersistedMediaUploadJob = {
  jobId: string;
  title: string;
  caption: string;
  fileUri: string;
  localPosterUri?: string;
  fileName: string;
  churchId: string;
  userId: string;
  role: string;
  phase: MediaUploadJobPhase;
  uploadProgress: number;
  pausedAtProgress?: number;
  backendFeedId?: string;
  videoUrl?: string;
  posterUri?: string;
  mediaStatus?: string;
  error?: string;
  pauseReason?: string;
  durationMs?: number;
  resumableMode: MediaUploadResumableMode;
  chunkSessionId?: string;
  uploadedChunkIndexes?: number[];
  totalChunks?: number;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "kristo_media_upload_jobs_v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: PersistedMediaUploadJob[] | null = null;

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function nowIso() {
  return new Date().toISOString();
}

export function createMediaUploadJobId() {
  return `media-upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readAllJobs(): Promise<PersistedMediaUploadJob[]> {
  if (cache) return cache.slice();

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = [];
      return [];
    }
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
    return cache.slice();
  } catch {
    cache = [];
    return [];
  }
}

async function writeAllJobs(jobs: PersistedMediaUploadJob[]) {
  cache = jobs.slice();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  emit();
}

export function subscribeMediaUploadJobs(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function listMediaUploadJobs(churchId?: string) {
  const jobs = await readAllJobs();
  if (!churchId) return jobs;
  return jobs.filter((job) => String(job.churchId || "").trim() === String(churchId).trim());
}

export async function getMediaUploadJob(jobId: string) {
  const jobs = await readAllJobs();
  return jobs.find((job) => job.jobId === jobId) || null;
}

export async function upsertMediaUploadJob(job: PersistedMediaUploadJob) {
  const jobs = await readAllJobs();
  const index = jobs.findIndex((row) => row.jobId === job.jobId);
  const next = { ...job, updatedAt: nowIso() };

  if (index >= 0) {
    jobs[index] = next;
  } else {
    jobs.unshift(next);
  }

  await writeAllJobs(jobs);
  return next;
}

export async function patchMediaUploadJob(
  jobId: string,
  patch: Partial<PersistedMediaUploadJob>
) {
  const jobs = await readAllJobs();
  const index = jobs.findIndex((row) => row.jobId === jobId);
  if (index < 0) return null;

  const next = {
    ...jobs[index],
    ...patch,
    jobId,
    updatedAt: nowIso(),
  };
  jobs[index] = next;
  await writeAllJobs(jobs);
  return next;
}

export async function removeMediaUploadJob(jobId: string) {
  const jobs = await readAllJobs();
  const next = jobs.filter((row) => row.jobId !== jobId);
  if (next.length === jobs.length) return false;
  await writeAllJobs(next);
  return true;
}

export async function createMediaUploadJob(
  input: Omit<
    PersistedMediaUploadJob,
    "jobId" | "phase" | "uploadProgress" | "createdAt" | "updatedAt" | "resumableMode"
  > & {
    jobId?: string;
    resumableMode?: MediaUploadResumableMode;
    chunkSessionId?: string;
  }
) {
  const createdAt = nowIso();
  const jobId = input.jobId || createMediaUploadJobId();
  const job: PersistedMediaUploadJob = {
    jobId,
    title: input.title,
    caption: input.caption,
    fileUri: input.fileUri,
    localPosterUri: input.localPosterUri,
    fileName: input.fileName,
    churchId: input.churchId,
    userId: input.userId,
    role: input.role,
    durationMs: input.durationMs,
    phase: "preparing",
    uploadProgress: 1,
    resumableMode: input.resumableMode || "chunk",
    chunkSessionId: input.chunkSessionId || jobId,
    createdAt,
    updatedAt: createdAt,
  };

  await upsertMediaUploadJob(job);
  console.log("KRISTO_MEDIA_UPLOAD_JOB_CREATED", {
    jobId: job.jobId,
    title: job.title,
    resumableMode: job.resumableMode,
  });
  return job;
}

export function listActiveMediaUploadJobs(jobs: PersistedMediaUploadJob[]) {
  return jobs.filter((job) => job.phase !== "ready");
}

export type FeedRowForMediaJobCleanup = {
  id: string;
  title?: string;
  text?: string;
  body?: string;
  caption?: string;
  mediaStatus?: string;
  videoUrl?: string;
  videoUri?: string;
  mediaUrl?: string;
  source?: string;
  postOrigin?: string;
  createdAt?: string;
};

function normalizeJobText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMediaUrl(value: unknown) {
  return String(value || "").trim().split("?")[0].toLowerCase();
}

function mediaUploadJobSignature(job: Pick<PersistedMediaUploadJob, "title" | "caption">) {
  return `${normalizeJobText(job.title)}|${normalizeJobText(job.caption)}`;
}

function jobMediaTexts(job: Pick<PersistedMediaUploadJob, "title" | "caption">) {
  return [job.title, job.caption].map(normalizeJobText).filter(Boolean);
}

function rowMediaTexts(row: FeedRowForMediaJobCleanup) {
  return [row.title, row.text, row.body, row.caption].map(normalizeJobText).filter(Boolean);
}

function rowVideoUrl(row: FeedRowForMediaJobCleanup) {
  return normalizeMediaUrl(row.videoUrl || row.videoUri || row.mediaUrl);
}

function jobVideoUrl(job: PersistedMediaUploadJob) {
  return normalizeMediaUrl(job.videoUrl);
}

export function feedRowMatchesMediaUploadJob(
  job: PersistedMediaUploadJob,
  row: FeedRowForMediaJobCleanup
) {
  const backendFeedId = String(job.backendFeedId || "").trim();
  const rowId = String(row.id || "").trim();
  if (backendFeedId && rowId && backendFeedId === rowId) return true;

  const jobUrl = jobVideoUrl(job);
  const apiUrl = rowVideoUrl(row);
  if (jobUrl && apiUrl && jobUrl === apiUrl) return true;

  const jobTexts = jobMediaTexts(job);
  const rowTexts = rowMediaTexts(row);
  if (!jobTexts.length || !rowTexts.length) return false;

  return jobTexts.some((jobText) => rowTexts.some((rowText) => jobText === rowText));
}

export function findMatchingApiMediaRow(
  job: PersistedMediaUploadJob,
  feedRows: FeedRowForMediaJobCleanup[]
) {
  const backendFeedId = String(job.backendFeedId || "").trim();
  if (backendFeedId) {
    const byId = feedRows.find((row) => String(row.id || "").trim() === backendFeedId);
    if (byId) return byId;
  }

  return feedRows.find((row) => feedRowMatchesMediaUploadJob(job, row)) || null;
}

export function buildMediaJobCleanupRowsFromApi(apiRows: any[]): FeedRowForMediaJobCleanup[] {
  const seen = new Set<string>();
  const rows: FeedRowForMediaJobCleanup[] = [];

  for (const row of apiRows) {
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      title: row?.title,
      text: row?.text,
      body: row?.body,
      caption: row?.caption,
      mediaStatus: row?.mediaStatus,
      videoUrl: row?.videoUrl,
      videoUri: row?.videoUri,
      mediaUrl: row?.mediaUrl,
      source: row?.source,
      postOrigin: row?.postOrigin,
      createdAt: row?.createdAt,
    });
  }

  return rows;
}

/** Hide stale failed cards when the feed row or a published job already exists. */
export function filterMediaStorageUploadJobs(
  jobs: PersistedMediaUploadJob[],
  feedRows: FeedRowForMediaJobCleanup[] = []
) {
  const active = listActiveMediaUploadJobs(jobs);
  const publishedSignatures = new Set(
    jobs
      .filter(
        (job) =>
          String(job.backendFeedId || "").trim() ||
          job.phase === "processing" ||
          job.phase === "preparing" ||
          job.phase === "optimizing" ||
          job.phase === "uploading" ||
          job.phase === "finalizing"
      )
      .map((job) => mediaUploadJobSignature(job))
  );

  return active.filter((job) => {
    const backendFeedId = String(job.backendFeedId || "").trim();

    if (job.phase === "failed" && backendFeedId) {
      return false;
    }

    if (job.phase === "failed") {
      if (backendFeedId && feedRows.some((row) => String(row.id || "").trim() === backendFeedId)) {
        return false;
      }
      if (feedRows.some((row) => feedRowMatchesMediaUploadJob(job, row))) {
        return false;
      }
      const sig = mediaUploadJobSignature(job);
      if (sig.replace("|", "") && publishedSignatures.has(sig)) {
        const hasPublishedSibling = jobs.some(
          (other) =>
            other.jobId !== job.jobId &&
            mediaUploadJobSignature(other) === sig &&
            (String(other.backendFeedId || "").trim() || other.phase === "processing")
        );
        if (hasPublishedSibling) return false;
      }
    }

    return true;
  });
}

async function removeStaleFailedMediaUploadJob(
  job: PersistedMediaUploadJob,
  reason: string,
  extra: Record<string, unknown> = {}
) {
  const removed = await removeMediaUploadJob(job.jobId);
  if (!removed) return false;
  console.log("KRISTO_MEDIA_FAILED_JOB_CLEANED", {
    jobId: job.jobId,
    title: job.title,
    backendFeedId: job.backendFeedId || null,
    reason,
    ...extra,
  });
  return true;
}

export async function reconcileStaleMediaUploadJobs(
  churchId: string,
  feedRows: FeedRowForMediaJobCleanup[] = []
) {
  const cleaned: string[] = [];
  const recovered: string[] = [];

  if (!feedRows.length) {
    return { cleaned, recovered };
  }

  const feedIds = new Set(feedRows.map((row) => String(row.id || "").trim()).filter(Boolean));
  const jobs = await listMediaUploadJobs(churchId);

  for (const job of jobs) {
    const backendFeedId = String(job.backendFeedId || "").trim();
    const feedRow = findMatchingApiMediaRow(job, feedRows);
    const feedRowId = String(feedRow?.id || "").trim();

    if (job.phase === "failed") {
      if (backendFeedId && feedIds.has(backendFeedId)) {
        if (
          await removeStaleFailedMediaUploadJob(job, "failed-backend-feed-id-in-api", {
            apiFeedId: backendFeedId,
          })
        ) {
          cleaned.push(job.jobId);
        }
        continue;
      }

      if (feedRow) {
        if (
          await removeStaleFailedMediaUploadJob(job, "failed-matches-api-media-item", {
            apiFeedId: feedRowId,
            matchBy: backendFeedId && feedRowId === backendFeedId ? "backendFeedId" : "title-or-videoUrl",
          })
        ) {
          cleaned.push(job.jobId);
        }
        continue;
      }

      const sig = mediaUploadJobSignature(job);
      if (sig.replace("|", "")) {
        const publishedSibling = jobs.find(
          (other) =>
            other.jobId !== job.jobId &&
            mediaUploadJobSignature(other) === sig &&
            (String(other.backendFeedId || "").trim() || other.phase === "processing")
        );
        if (publishedSibling) {
          if (
            await removeStaleFailedMediaUploadJob(job, "stale-failed-duplicate-local-job", {
              duplicateOf: publishedSibling.jobId,
              backendFeedId: publishedSibling.backendFeedId || null,
            })
          ) {
            cleaned.push(job.jobId);
          }
        }
      }

      continue;
    }

    if ((job.phase === "paused" || job.phase === "processing") && feedRow) {
      const mediaStatus = normalizeMediaStatus(feedRow.mediaStatus);
      const matchId = feedRowId || backendFeedId;
      if (mediaStatus === "ready" && matchId) {
        const removed = await removeMediaUploadJob(job.jobId);
        if (removed) {
          cleaned.push(job.jobId);
          console.log("KRISTO_MEDIA_FAILED_JOB_CLEANED", {
            jobId: job.jobId,
            backendFeedId: matchId,
            reason: "stale-active-job-api-ready",
          });
        }
        continue;
      }

      if (matchId && (job.phase === "paused" || !backendFeedId)) {
        await patchMediaUploadJob(job.jobId, {
          phase: "processing",
          backendFeedId: matchId,
          error: "",
          uploadProgress: 100,
          mediaStatus,
          videoUrl: job.videoUrl || feedRow.videoUrl || feedRow.videoUri || feedRow.mediaUrl,
        });
        recovered.push(job.jobId);
        console.log("KRISTO_MEDIA_FAILED_JOB_RECOVERED", {
          jobId: job.jobId,
          backendFeedId: matchId,
          reason: "active-job-matches-api-media-item",
        });
      }
    }
  }

  return { cleaned, recovered };
}

export async function hydrateMediaUploadJobs(churchId?: string) {
  const jobs = await readAllJobs();
  if (churchId) {
    await reconcileStaleMediaUploadJobs(churchId);
  }
  return jobs;
}
