import { Image, ImageSourcePropType } from "react-native";

export const TLMC_BACKGROUND_SOURCES = {
  universe: require("../../assets/images/tlmc/sehemu-yangu-gate.png"),
  commandPad: require("../../assets/images/tlmc/sehemu-yangu-gate.png"),
} as const;

export const TLMC_UNIVERSE_IMAGE = TLMC_BACKGROUND_SOURCES.universe;

let tlmcPreloadDone = false;
let tlmcPreloadInflight: Promise<void> | null = null;

async function warmImageSource(source: ImageSourcePropType) {
  const resolved = Image.resolveAssetSource(source);
  const uri = String(resolved?.uri || "").trim();
  if (!uri) return;

  if (/^https?:\/\//i.test(uri) || uri.startsWith("file://")) {
    await Image.prefetch(uri);
  }
}

export function isTlmcAssetsPreloaded() {
  return tlmcPreloadDone;
}

export function preloadTlmcAssets(options?: { force?: boolean }) {
  const force = !!options?.force;

  if (tlmcPreloadDone && !force) {
    return Promise.resolve();
  }

  if (tlmcPreloadInflight && !force) {
    return tlmcPreloadInflight;
  }

  tlmcPreloadInflight = (async () => {
    try {
      const uniqueSources = Array.from(
        new Set(Object.values(TLMC_BACKGROUND_SOURCES))
      );

      await Promise.all(uniqueSources.map((source) => warmImageSource(source)));

      tlmcPreloadDone = true;
      console.log("KRISTO_TLMC_PRELOAD_OK");
    } catch (e) {
      console.log("KRISTO_TLMC_PRELOAD_ERROR", e);
    } finally {
      tlmcPreloadInflight = null;
    }
  })();

  return tlmcPreloadInflight;
}
