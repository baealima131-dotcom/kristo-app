import { Image, ImageSourcePropType } from "react-native";

export const MEDIA_STUDIO_BACKGROUND = require("../../assets/media/media-studio-gold.png");

let mediaPreloadDone = false;
let mediaPreloadInflight: Promise<void> | null = null;

async function warmImageSource(source: ImageSourcePropType) {
  const resolved = Image.resolveAssetSource(source);
  const uri = String(resolved?.uri || "").trim();
  if (!uri) return;

  if (/^https?:\/\//i.test(uri) || uri.startsWith("file://")) {
    await Image.prefetch(uri);
  }
}

export function isMediaAssetsPreloaded() {
  return mediaPreloadDone;
}

export function preloadMediaAssets(options?: { force?: boolean }) {
  const force = !!options?.force;

  if (mediaPreloadDone && !force) {
    return Promise.resolve();
  }

  if (mediaPreloadInflight && !force) {
    return mediaPreloadInflight;
  }

  mediaPreloadInflight = (async () => {
    try {
      await warmImageSource(MEDIA_STUDIO_BACKGROUND);
      mediaPreloadDone = true;
      console.log("KRISTO_MEDIA_PRELOAD_OK");
    } catch (e) {
      console.log("KRISTO_MEDIA_PRELOAD_ERROR", e);
    } finally {
      mediaPreloadInflight = null;
    }
  })();

  return mediaPreloadInflight;
}
