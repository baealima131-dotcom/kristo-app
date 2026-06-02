import AsyncStorage from "@react-native-async-storage/async-storage";

export type MediaUploadJobPhase =
  | "uploading"
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
    phase: "uploading",
    uploadProgress: 0,
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

export async function hydrateMediaUploadJobs() {
  return readAllJobs();
}
