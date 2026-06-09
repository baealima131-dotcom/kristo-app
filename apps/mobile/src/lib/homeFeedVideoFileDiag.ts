import { computeVideoBitrateEstimate } from "@/src/lib/churchVideoUpload";

export type HomeFeedVideoFileDiag = {
  contentLength: number | null;
  bitrate: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
};

const PROBE_START_BYTES = 524_287;
const PROBE_TAIL_BYTES = 131_071;
const PROBE_TIMEOUT_MS = 8_000;

let firstMountedVideoFileDiagLogged = false;

function parseHeaderContentLength(headers: Headers): number | null {
  const value = Number(headers.get("content-length") || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function atomIndex(buf: Uint8Array, atom: string, from = 0): number {
  if (atom.length !== 4 || buf.length < from + 4) return -1;
  const limit = buf.length - 4;
  for (let i = Math.max(0, from); i <= limit; i += 1) {
    if (
      buf[i] === atom.charCodeAt(0) &&
      buf[i + 1] === atom.charCodeAt(1) &&
      buf[i + 2] === atom.charCodeAt(2) &&
      buf[i + 3] === atom.charCodeAt(3)
    ) {
      return i;
    }
  }
  return -1;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) return 0;
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function readFixed1616(buf: Uint8Array, offset: number): number {
  const raw = readU32BE(buf, offset);
  return raw > 0 ? Math.round(raw / 65536) : 0;
}

function detectCodecFromBytes(buf: Uint8Array): string | null {
  const markers: Array<{ token: string; codec: string }> = [
    { token: "avc1", codec: "H264" },
    { token: "avc3", codec: "H264" },
    { token: "hvc1", codec: "H265" },
    { token: "hev1", codec: "H265" },
    { token: "mp4v", codec: "MPEG4" },
  ];
  const limit = Math.min(buf.length, 512 * 1024);
  for (const { token, codec } of markers) {
    if (atomIndex(buf.subarray(0, limit), token) >= 0) return codec;
  }
  return null;
}

function parseTkhdDimensions(buf: Uint8Array): { width: number; height: number } | null {
  let cursor = 0;
  while (cursor + 8 <= buf.length) {
    const size = readU32BE(buf, cursor);
    const type = String.fromCharCode(
      buf[cursor + 4],
      buf[cursor + 5],
      buf[cursor + 6],
      buf[cursor + 7]
    );
    if (size < 8) break;
    const end = Math.min(buf.length, cursor + size);
    if (type === "tkhd" && end - cursor >= 92) {
      const version = buf[cursor + 8];
      const base = cursor + 8 + (version === 1 ? 84 : 76);
      const width = readFixed1616(buf, base);
      const height = readFixed1616(buf, base + 4);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    cursor = end;
  }
  return null;
}

function moovPositionHintFromBytes(startBuf: Uint8Array, tailBuf: Uint8Array | null): string {
  const startMoov = atomIndex(startBuf, "moov");
  const startMdat = atomIndex(startBuf, "mdat");
  if (startMoov >= 0 && (startMdat < 0 || startMoov < startMdat)) return "start";
  if (startMdat >= 0 && startMoov < 0) return "end";
  if (tailBuf && atomIndex(tailBuf, "moov") >= 0) return "end";
  if (startMoov >= 0) return "unknown";
  return "unknown";
}

async function fetchRange(url: string, start: number, end: number, signal: AbortSignal) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  });
  if (!res.ok && res.status !== 206) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export async function probeHomeFeedVideoFileDiag(
  videoUrl: string,
  hints?: { contentLength?: number; durationMs?: number }
): Promise<HomeFeedVideoFileDiag> {
  const url = String(videoUrl || "").trim();
  const durationMsHint = Number(hints?.durationMs || 0);
  const durationHintSec =
    Number.isFinite(durationMsHint) && durationMsHint > 0
      ? Math.round((durationMsHint / 1000) * 100) / 100
      : null;

  if (!url || !/^https?:\/\//i.test(url)) {
    const contentLength =
      Number(hints?.contentLength || 0) > 0 ? Number(hints?.contentLength) : null;
    const bitrate =
      contentLength && durationHintSec
        ? computeVideoBitrateEstimate(contentLength, durationMsHint) ?? null
        : null;
    return {
      contentLength,
      bitrate,
      width: null,
      height: null,
      duration: durationHintSec,
      codec: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    let contentLength =
      Number(hints?.contentLength || 0) > 0 ? Number(hints.contentLength) : null;

    try {
      const head = await fetch(url, { method: "HEAD", signal: controller.signal });
      contentLength = parseHeaderContentLength(head.headers) ?? contentLength;
    } catch {}

    const startBuf = await fetchRange(url, 0, PROBE_START_BYTES, controller.signal);
    let tailBuf: Uint8Array | null = null;
    if (contentLength && contentLength > PROBE_START_BYTES + 4096) {
      const tailStart = Math.max(0, contentLength - PROBE_TAIL_BYTES);
      tailBuf = await fetchRange(
        url,
        tailStart,
        contentLength - 1,
        controller.signal
      );
    }

    const codec = startBuf ? detectCodecFromBytes(startBuf) : null;
    const dims = startBuf ? parseTkhdDimensions(startBuf) : null;
    const moovHint = startBuf
      ? moovPositionHintFromBytes(startBuf, tailBuf)
      : "unknown";

    const bitrate =
      contentLength && durationHintSec
        ? computeVideoBitrateEstimate(contentLength, durationMsHint) ?? null
        : null;

    if (__DEV__ && moovHint === "end") {
      console.log("KRISTO_VIDEO_FILE_DIAG_MOOV", {
        moovPositionHint: moovHint,
        contentLength,
        videoUrlHost: (() => {
          try {
            return new URL(url).host;
          } catch {
            return null;
          }
        })(),
      });
    }

    return {
      contentLength,
      bitrate,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      duration: durationHintSec,
      codec,
    };
  } catch {
    const contentLength =
      Number(hints?.contentLength || 0) > 0 ? Number(hints?.contentLength) : null;
    const bitrate =
      contentLength && durationHintSec
        ? computeVideoBitrateEstimate(contentLength, durationMsHint) ?? null
        : null;
    return {
      contentLength,
      bitrate,
      width: null,
      height: null,
      duration: durationHintSec,
      codec: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Log KRISTO_VIDEO_FILE_DIAG once for the first mounted Home Feed video. */
export async function logFirstMountedHomeFeedVideoFileDiag(params: {
  playbackUri: string;
  contentLength?: number;
  durationMs?: number;
  playerDurationSec?: number | null;
}) {
  if (firstMountedVideoFileDiagLogged) return;
  firstMountedVideoFileDiagLogged = true;

  const diag = await probeHomeFeedVideoFileDiag(params.playbackUri, {
    contentLength: params.contentLength,
    durationMs: params.durationMs,
  });

  const playerDuration =
    Number(params.playerDurationSec || 0) > 0
      ? Math.round(Number(params.playerDurationSec) * 100) / 100
      : null;
  const duration = playerDuration ?? diag.duration;
  const bitrate =
    diag.contentLength && duration
      ? computeVideoBitrateEstimate(diag.contentLength, Math.round(duration * 1000)) ??
        diag.bitrate
      : diag.bitrate;

  console.log("KRISTO_VIDEO_FILE_DIAG", {
    contentLength: diag.contentLength,
    bitrate,
    width: diag.width,
    height: diag.height,
    duration,
    codec: diag.codec,
  });
}

export function resetHomeFeedVideoFileDiagForTests() {
  firstMountedVideoFileDiagLogged = false;
}
