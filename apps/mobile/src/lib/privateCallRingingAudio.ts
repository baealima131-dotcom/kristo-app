import * as FileSystem from "expo-file-system/legacy";
import {
  PRIVATE_CALL_UNAVAILABLE_BASE64,
  PRIVATE_CALL_WAITTONE_BASE64,
} from "@/src/lib/privateCallAudioData";

export type PrivateCallRingingAudioUris = {
  waittone: string;
  unavailable: string;
};

let cachedUrisPromise: Promise<PrivateCallRingingAudioUris> | null = null;

export function ensurePrivateCallRingingAudioFiles(): Promise<PrivateCallRingingAudioUris> {
  if (cachedUrisPromise) return cachedUrisPromise;

  cachedUrisPromise = (async () => {
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) throw new Error("Private call audio cache is unavailable.");

    const directory = `${baseDirectory}private-call-audio/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => null);

    const waittone = `${directory}private-call-waittone.mp3`;
    const unavailable = `${directory}private-call-unavailable.mp3`;

    const writeIfMissing = async (uri: string, base64: string) => {
      const info = await FileSystem.getInfoAsync(uri).catch(() => null);
      if (info?.exists && Number((info as any).size || 0) > 0) return;
      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    };

    await Promise.all([
      writeIfMissing(waittone, PRIVATE_CALL_WAITTONE_BASE64),
      writeIfMissing(unavailable, PRIVATE_CALL_UNAVAILABLE_BASE64),
    ]);

    return { waittone, unavailable };
  })().catch((error) => {
    cachedUrisPromise = null;
    throw error;
  });

  return cachedUrisPromise;
}
