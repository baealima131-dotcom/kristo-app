import { loadFileSystemLegacy } from "@/src/lib/nativeModuleLoaders";

/**
 * Exact on-disk byte size, 0 when the file is missing or empty.
 * Unlike resolveUploadFileSize there is no base64 estimate (which reports an empty file as 1 byte).
 */
export async function localFileByteSize(uri: string): Promise<number> {
  const FileSystem = await loadFileSystemLegacy();
  const info: any = await FileSystem.getInfoAsync(uri, { size: true } as any);
  if (!info?.exists || info?.isDirectory) return 0;
  const size = Number(info?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}
