import { generateVideoPosterFrame } from "@/src/lib/mediaVideoPoster";

export async function generateLocalVideoPosterUri(
  videoUri: string,
  durationMs?: number
): Promise<string | null> {
  const uri = await generateVideoPosterFrame({
    videoUrl: videoUri,
    durationMs,
  });
  return uri || null;
}
