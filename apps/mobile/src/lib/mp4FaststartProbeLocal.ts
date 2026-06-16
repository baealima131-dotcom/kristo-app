export type Mp4FaststartLocalProbeResult = {
  hasFastStart: boolean;
  moovPositionHint: "start" | "end" | "unknown" | "not-mp4";
  fileBytes: number;
};

const PROBE_START_BYTES = 256 * 1024;

function atomIndex(buf: Uint8Array, atom: string): number {
  const needle = atom.charCodeAt(0);
  const limit = buf.length - atom.length;
  for (let i = 0; i <= limit; i += 1) {
    if (buf[i] !== needle) continue;
    let match = true;
    for (let j = 1; j < atom.length; j += 1) {
      if (buf[i + j] !== atom.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

async function readLocalFileHeadBytes(uri: string, length: number): Promise<Uint8Array | null> {
  const cleanUri = String(uri || "").trim();
  if (!cleanUri) return null;

  try {
    const FileSystem = await import("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(cleanUri, { size: true } as any);
    if (!(info as any)?.exists) return null;

    const fileBytes = Math.max(0, Number((info as any)?.size || 0));
    const readLength = Math.min(Math.max(1, length), fileBytes || length);

    const base64 = await FileSystem.readAsStringAsync(cleanUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: readLength,
    } as any);

    const binary = globalThis.atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function resolveLocalFileBytes(uri: string): Promise<number> {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
    return Math.max(0, Number((info as any)?.size || 0));
  } catch {
    return 0;
  }
}

/**
 * Lightweight local MP4 probe: moov before mdat in the first 256KB ⇒ fast-start friendly.
 */
export async function probeMp4FaststartFromLocalUri(
  uri: string
): Promise<Mp4FaststartLocalProbeResult> {
  const cleanUri = String(uri || "").trim();
  const fileBytes = await resolveLocalFileBytes(cleanUri);

  if (!cleanUri) {
    return { hasFastStart: false, moovPositionHint: "not-mp4", fileBytes: 0 };
  }

  const lower = cleanUri.split("?")[0].toLowerCase();
  if (!/\.(mp4|m4v|mov)(\?|#|$)/.test(lower) && fileBytes > 0) {
    // Still attempt atom scan — compressor output may lack extension in temp paths.
  }

  const head = await readLocalFileHeadBytes(cleanUri, PROBE_START_BYTES);
  if (!head || head.length === 0) {
    return { hasFastStart: false, moovPositionHint: "unknown", fileBytes };
  }

  const startMoov = atomIndex(head, "moov");
  const startMdat = atomIndex(head, "mdat");
  const startFtyp = atomIndex(head, "ftyp");

  if (startFtyp < 0 && startMoov < 0 && startMdat < 0) {
    return { hasFastStart: false, moovPositionHint: "not-mp4", fileBytes };
  }

  if (startMoov >= 0 && (startMdat < 0 || startMoov < startMdat)) {
    return { hasFastStart: true, moovPositionHint: "start", fileBytes };
  }

  if (startMdat >= 0 && startMoov < 0) {
    return { hasFastStart: false, moovPositionHint: "end", fileBytes };
  }

  if (startMdat >= 0 && startMoov >= 0 && startMdat < startMoov) {
    return { hasFastStart: false, moovPositionHint: "end", fileBytes };
  }

  return { hasFastStart: false, moovPositionHint: "unknown", fileBytes };
}
