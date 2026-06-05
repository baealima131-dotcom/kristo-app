import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

/** Longest side after resize. */
const MAX_SIDE = 1280;
/** Soft target: keep room images comfortably small for upload. */
const TARGET_BYTES = 2 * 1024 * 1024;
/**
 * Hard ceiling. Vercel rejects request bodies larger than ~4.5MB with a 413,
 * so anything above this would fail to upload regardless of server limits.
 */
const HARD_MAX_BYTES = 4 * 1024 * 1024;

export const ROOM_IMAGE_TOO_LARGE_MESSAGE =
  "Image is too large. Please choose a smaller image.";

type Attempt = { maxSide: number; quality: number };

// Primary attempt matches the product spec (1280 / 0.72). Subsequent attempts
// step down dimensions and quality so we can still get most photos under the
// soft target without throwing away too much detail.
const ATTEMPTS: Attempt[] = [
  { maxSide: MAX_SIDE, quality: 0.72 },
  { maxSide: MAX_SIDE, quality: 0.6 },
  { maxSide: 1024, quality: 0.6 },
  { maxSide: 1024, quality: 0.5 },
  { maxSide: 800, quality: 0.5 },
];

export type CompressedRoomImage = {
  uri: string;
  size: number;
  width?: number;
  height?: number;
};

async function fileByteSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
    if (!info.exists) return 0;
    return Number((info as any).size || 0);
  } catch {
    return 0;
  }
}

function resizeActions(
  maxSide: number,
  width?: number,
  height?: number
): ImageManipulator.Action[] {
  const w = Number(width || 0);
  const h = Number(height || 0);

  // Unknown dimensions: constrain by width and let height scale proportionally.
  if (!w || !h) return [{ resize: { width: maxSide } }];

  // Already within bounds: re-encode/compress only (no upscale).
  if (w <= maxSide && h <= maxSide) return [];

  // Constrain the longer side so neither dimension exceeds maxSide.
  return w >= h ? [{ resize: { width: maxSide } }] : [{ resize: { height: maxSide } }];
}

/**
 * Resize + JPEG-compress a local image so it can be uploaded as a room
 * attachment without tripping the server / platform request-size limit.
 *
 * Throws an Error with ROOM_IMAGE_TOO_LARGE_MESSAGE if the image cannot be
 * brought under the hard ceiling.
 */
export async function compressRoomImage(
  sourceUri: string,
  sourceWidth?: number,
  sourceHeight?: number
): Promise<CompressedRoomImage> {
  const uri = String(sourceUri || "").trim();
  if (!uri) throw new Error(ROOM_IMAGE_TOO_LARGE_MESSAGE);

  let best: CompressedRoomImage | null = null;

  for (const attempt of ATTEMPTS) {
    let result: ImageManipulator.ImageResult;
    try {
      result = await ImageManipulator.manipulateAsync(
        uri,
        resizeActions(attempt.maxSide, sourceWidth, sourceHeight),
        { compress: attempt.quality, format: ImageManipulator.SaveFormat.JPEG }
      );
    } catch {
      continue;
    }

    const outUri = String(result.uri || "").trim();
    if (!outUri) continue;

    const size = await fileByteSize(outUri);
    const candidate: CompressedRoomImage = {
      uri: outUri,
      size,
      width: result.width,
      height: result.height,
    };

    if (!best || (size > 0 && size < best.size)) best = candidate;

    if (size > 0 && size <= TARGET_BYTES) return candidate;
  }

  if (best && best.size > 0 && best.size <= HARD_MAX_BYTES) return best;

  throw new Error(ROOM_IMAGE_TOO_LARGE_MESSAGE);
}
