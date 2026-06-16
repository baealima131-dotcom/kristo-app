import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

/** Stay below server MAX_AVATAR_DATA_URL_LEN (2_800_000) with headroom. */
const MAX_DATA_URL_LEN = 1_900_000;

type CompressAttempt = {
  maxSide: number;
  quality: number;
};

const ATTEMPTS: CompressAttempt[] = [
  { maxSide: 768, quality: 0.68 },
  { maxSide: 768, quality: 0.58 },
  { maxSide: 512, quality: 0.65 },
  { maxSide: 512, quality: 0.52 },
  { maxSide: 384, quality: 0.48 },
];

async function fileByteSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
    if (!info.exists) return 0;
    return Number((info as any).size || 0);
  } catch {
    return 0;
  }
}

function dataUrlByteSize(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).length;
}

async function compressOnce(uri: string, maxSide: number, quality: number) {
  return ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxSide, height: maxSide } }],
    {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    }
  );
}

/**
 * Resize + compress a local image URI into a JPEG data URL safe for upload.
 */
export async function buildAvatarDataUrl(sourceUri: string): Promise<string> {
  const uri = String(sourceUri || "").trim();
  if (!uri || !uri.startsWith("file:")) return "";

  const beforeSize = await fileByteSize(uri);
  console.log("[AvatarCompress] beforeSize", beforeSize);

  let lastDataUrl = "";

  for (const attempt of ATTEMPTS) {
    const result = await compressOnce(uri, attempt.maxSide, attempt.quality);
    const b64 = String(result.base64 || "").trim();
    if (!b64) continue;

    const dataUrl = `data:image/jpeg;base64,${b64}`;
    lastDataUrl = dataUrl;

    const afterSize = dataUrlByteSize(dataUrl);
    console.log("[AvatarCompress] afterSize", afterSize, {
      maxSide: attempt.maxSide,
      quality: attempt.quality,
    });

    if (afterSize <= MAX_DATA_URL_LEN) {
      return dataUrl;
    }
  }

  if (lastDataUrl && dataUrlByteSize(lastDataUrl) <= MAX_DATA_URL_LEN) {
    return lastDataUrl;
  }

  throw new Error("Avatar image is too large. Choose a smaller photo (max ~2MB).");
}

/**
 * Compress for local preview storage (returns file:// JPEG path).
 */
export async function compressAvatarFile(sourceUri: string, destUri: string): Promise<string> {
  const uri = String(sourceUri || "").trim();
  if (!uri.startsWith("file:")) return uri;

  const beforeSize = await fileByteSize(uri);
  console.log("[AvatarCompress] beforeSize", beforeSize);

  for (const attempt of ATTEMPTS) {
    const result = await compressOnce(uri, attempt.maxSide, attempt.quality);
    const outUri = String(result.uri || "").trim();
    if (!outUri) continue;

    if (outUri !== destUri) {
      await FileSystem.copyAsync({ from: outUri, to: destUri }).catch(async () => {
        await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
        await FileSystem.copyAsync({ from: outUri, to: destUri });
      });
    }

    const afterSize = await fileByteSize(destUri);
    console.log("[AvatarCompress] afterSize", afterSize, {
      maxSide: attempt.maxSide,
      quality: attempt.quality,
    });

    if (afterSize > 0 && afterSize <= MAX_DATA_URL_LEN * 0.75) {
      return destUri;
    }
  }

  return destUri;
}
