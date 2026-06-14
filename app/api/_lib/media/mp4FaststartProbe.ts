export type Mp4FaststartProbeResult = {
  hasFastStart: boolean;
  moovPositionHint: "start" | "end" | "unknown" | "not-mp4";
  contentLength: number | null;
};

const PROBE_START_BYTES = 262_143;
const PROBE_TAIL_BYTES = 131_071;
const PROBE_TIMEOUT_MS = 8_000;

function atomIndex(buf: Buffer, atom: string): number {
  return buf.indexOf(atom);
}

function parseContentLength(header: string | null): number | null {
  const value = Number(header || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Lightweight MP4 probe: moov before mdat in the first range ⇒ fast-start friendly.
 */
export async function probeMp4FaststartFromUrl(
  videoUrl: string
): Promise<Mp4FaststartProbeResult> {
  const url = String(videoUrl || "").trim().split("?")[0];
  if (!url || !/\.(mp4|m4v|mov)(\?|#|$)/i.test(url)) {
    return { hasFastStart: false, moovPositionHint: "not-mp4", contentLength: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const headRes = await fetch(url, { method: "HEAD", signal: controller.signal });
    const contentLength = parseContentLength(headRes.headers.get("content-length"));

    const startRes = await fetch(url, {
      method: "GET",
      headers: { Range: `bytes=0-${PROBE_START_BYTES}` },
      signal: controller.signal,
    });
    const startBuf = Buffer.from(await startRes.arrayBuffer());

    const startMoov = atomIndex(startBuf, "moov");
    const startMdat = atomIndex(startBuf, "mdat");
    const startFtyp = atomIndex(startBuf, "ftyp");

    if (startFtyp < 0 && startMoov < 0 && startMdat < 0) {
      return { hasFastStart: false, moovPositionHint: "unknown", contentLength };
    }

    if (startMoov >= 0 && (startMdat < 0 || startMoov < startMdat)) {
      return { hasFastStart: true, moovPositionHint: "start", contentLength };
    }

    if (startMdat >= 0 && startMoov < 0 && contentLength && contentLength > 65_536) {
      const tailStart = Math.max(0, contentLength - PROBE_TAIL_BYTES);
      const tailRes = await fetch(url, {
        method: "GET",
        headers: { Range: `bytes=${tailStart}-${contentLength - 1}` },
        signal: controller.signal,
      });
      const tailBuf = Buffer.from(await tailRes.arrayBuffer());
      if (atomIndex(tailBuf, "moov") >= 0) {
        return { hasFastStart: false, moovPositionHint: "end", contentLength };
      }
    }

    if (startMoov >= 0) {
      return {
        hasFastStart: startMdat < 0 || startMoov < startMdat,
        moovPositionHint: startMdat >= 0 && startMoov < startMdat ? "start" : "unknown",
        contentLength,
      };
    }

    return { hasFastStart: false, moovPositionHint: "unknown", contentLength };
  } catch {
    return { hasFastStart: false, moovPositionHint: "unknown", contentLength: null };
  } finally {
    clearTimeout(timer);
  }
}
