/**
 * Read a video's display width/height from its MP4/MOV header (the video track's `tkhd` box),
 * applying the track's rotation matrix so a portrait phone video reports portrait dimensions.
 *
 * Dependency-free so it can run in API routes and scripts. Remote files are read with HTTP
 * Range requests: the start of the file first (faststart uploads keep `moov` there), then the
 * end of the file when `moov` was written last.
 */

export type VideoDimensions = { width: number; height: number };

const MAX_DIMENSION = 16384;
const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 1024 * 1024;

export function normalizeVideoDimensions(width: unknown, height: unknown): VideoDimensions | null {
  const w = Math.round(Math.abs(Number(width)));
  const h = Math.round(Math.abs(Number(height)));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0 || w > MAX_DIMENSION || h > MAX_DIMENSION) return null;
  return { width: w, height: h };
}

type Box = { type: string; start: number; headerSize: number; end: number };

function readBoxes(view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      size = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize) break;
    const boxEnd = offset + size;
    boxes.push({ type, start: offset, headerSize, end: Math.min(boxEnd, end) });
    if (boxEnd > end) break;
    offset = boxEnd;
  }
  return boxes;
}

function readTkhd(view: DataView, box: Box): VideoDimensions | null {
  const body = box.start + box.headerSize;
  if (body + 4 > box.end) return null;
  const version = view.getUint8(body);
  // version(1)+flags(3), then times/track id/duration (v0: 20 bytes, v1: 32 bytes),
  // reserved(8), layer(2), alternate group(2), volume(2), reserved(2), matrix(36), width, height.
  const afterHeader = body + 4 + (version === 1 ? 32 : 20) + 8 + 8;
  const matrixStart = afterHeader;
  const widthOffset = matrixStart + 36;
  if (widthOffset + 8 > box.end) return null;
  const a = view.getInt32(matrixStart) / 65536;
  const b = view.getInt32(matrixStart + 4) / 65536;
  const width = view.getUint32(widthOffset) / 65536;
  const height = view.getUint32(widthOffset + 4) / 65536;
  const dims = normalizeVideoDimensions(width, height);
  if (!dims) return null;
  // A 90°/270° rotation matrix has a ≈ 0 and |b| ≈ 1: display dimensions are swapped.
  const rotated = Math.abs(a) < 0.5 && Math.abs(b) > 0.5;
  return rotated ? { width: dims.height, height: dims.width } : dims;
}

function trackIsVideo(view: DataView, trak: Box): boolean {
  const mdia = readBoxes(view, trak.start + trak.headerSize, trak.end).find((b) => b.type === "mdia");
  if (!mdia) return true; // no handler info: rely on non-zero tkhd size
  const hdlr = readBoxes(view, mdia.start + mdia.headerSize, mdia.end).find((b) => b.type === "hdlr");
  if (!hdlr) return true;
  const handlerOffset = hdlr.start + hdlr.headerSize + 8;
  if (handlerOffset + 4 > hdlr.end) return true;
  const handler = String.fromCharCode(
    view.getUint8(handlerOffset),
    view.getUint8(handlerOffset + 1),
    view.getUint8(handlerOffset + 2),
    view.getUint8(handlerOffset + 3)
  );
  return handler === "vide";
}

/** Parse display dimensions from a buffer that contains a complete `moov` box. */
export function parseMp4DisplayDimensions(bytes: Uint8Array): VideoDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findMoov = (): Box | null => {
    const top = readBoxes(view, 0, bytes.byteLength).find((b) => b.type === "moov");
    if (top) return top;
    // Tail buffers do not start on a box boundary: scan for the `moov` type marker.
    for (let i = 4; i + 4 <= bytes.byteLength; i += 1) {
      if (bytes[i] === 0x6d && bytes[i + 1] === 0x6f && bytes[i + 2] === 0x6f && bytes[i + 3] === 0x76) {
        const start = i - 4;
        const size = view.getUint32(start);
        if (size >= 8 && start + size <= bytes.byteLength) {
          return { type: "moov", start, headerSize: 8, end: start + size };
        }
      }
    }
    return null;
  };
  const moov = findMoov();
  if (!moov) return null;
  for (const trak of readBoxes(view, moov.start + moov.headerSize, moov.end)) {
    if (trak.type !== "trak") continue;
    if (!trackIsVideo(view, trak)) continue;
    const tkhd = readBoxes(view, trak.start + trak.headerSize, trak.end).find((b) => b.type === "tkhd");
    const dims = tkhd ? readTkhd(view, tkhd) : null;
    if (dims) return dims;
  }
  return null;
}

async function fetchRange(url: string, range: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Range: range }, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read display dimensions of a remote MP4/MOV. Returns null when they cannot be determined. */
export async function probeRemoteVideoDimensions(
  url: string,
  options: { timeoutMs?: number } = {}
): Promise<VideoDimensions | null> {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return null;
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 4000));

  const head = await fetchRange(target, `bytes=0-${HEAD_BYTES - 1}`, timeoutMs);
  if (!head || (head.status !== 206 && head.status !== 200)) return null;
  // A server that ignores Range returns the whole file (200): only read it if small enough.
  const headLength = Number(head.headers.get("content-length") || 0);
  if (head.status === 200 && headLength > 64 * 1024 * 1024) return null;
  const headBytes = new Uint8Array(await head.arrayBuffer());
  const fromHead = parseMp4DisplayDimensions(headBytes);
  if (fromHead || head.status === 200) return fromHead;

  const totalMatch = String(head.headers.get("content-range") || "").match(/\/(\d+)\s*$/);
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  if (!(total > HEAD_BYTES)) return null;
  const tailStart = Math.max(HEAD_BYTES, total - TAIL_BYTES);
  const tail = await fetchRange(target, `bytes=${tailStart}-${total - 1}`, timeoutMs);
  if (!tail || tail.status !== 206) return null;
  return parseMp4DisplayDimensions(new Uint8Array(await tail.arrayBuffer()));
}
