import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

/** Longest side after resize (Church Room feed testimony/post images). */
const MAX_SIDE = 1600;
/** Soft target: keep uploads comfortably under Vercel body limits. */
const TARGET_BYTES = 2 * 1024 * 1024;
/** Hard ceiling — Vercel rejects ~4.5MB request bodies with 413. */
const HARD_MAX_BYTES = 4 * 1024 * 1024;

export const CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE =
  "Image is too large. Please choose a smaller image.";

type Attempt = { maxSide: number; quality: number };

const ATTEMPTS: Attempt[] = [
  { maxSide: MAX_SIDE, quality: 0.72 },
  { maxSide: MAX_SIDE, quality: 0.6 },
  { maxSide: 1280, quality: 0.6 },
  { maxSide: 1024, quality: 0.55 },
  { maxSide: 800, quality: 0.5 },
];

export type CompressedChurchRoomFeedImage = {
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

  if (!w || !h) return [{ resize: { width: maxSide } }];
  if (w <= maxSide && h <= maxSide) return [];
  return w >= h ? [{ resize: { width: maxSide } }] : [{ resize: { height: maxSide } }];
}

export async function compressChurchRoomFeedImage(
  sourceUri: string,
  sourceWidth?: number,
  sourceHeight?: number
): Promise<CompressedChurchRoomFeedImage> {
  const uri = String(sourceUri || "").trim();
  if (!uri) throw new Error(CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE);

  let best: CompressedChurchRoomFeedImage | null = null;

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
    const candidate: CompressedChurchRoomFeedImage = {
      uri: outUri,
      size,
      width: result.width,
      height: result.height,
    };

    if (!best || (size > 0 && size < best.size)) best = candidate;
    if (size > 0 && size <= TARGET_BYTES) return candidate;
  }

  if (best && best.size > 0 && best.size <= HARD_MAX_BYTES) return best;

  throw new Error(CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE);
}
