import { Platform } from "react-native";

type VideoThumbnailsModule = typeof import("expo-video-thumbnails");
type FileSystemLegacyModule = typeof import("expo-file-system/legacy");

// KRISTO_ANDROID_SYNC_MODULE_LOADER_V1
// Android: Metro lazy async bundles for packages outside the project root are requested as
// "/../../kristo-app/..." and fail with "Unable to resolve module ./kristo-app/...".
// A static require keeps these packages in the main bundle. iOS keeps the dynamic import path.
export async function loadVideoThumbnails(): Promise<VideoThumbnailsModule> {
  if (Platform.OS === "android") {
    return require("expo-video-thumbnails") as VideoThumbnailsModule;
  }
  return import("expo-video-thumbnails");
}

export async function loadFileSystemLegacy(): Promise<FileSystemLegacyModule> {
  if (Platform.OS === "android") {
    return require("expo-file-system/legacy") as FileSystemLegacyModule;
  }
  return import("expo-file-system/legacy");
}
