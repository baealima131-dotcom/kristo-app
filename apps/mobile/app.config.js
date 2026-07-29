/** @type {import('expo/config').ExpoConfig} */
const fs = require("fs");
const os = require("os");
const path = require("path");
const appJson = require("./app.json");

const expo = appJson.expo;
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";

const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
  expo.extra?.revenuecatAndroidApiKey ||
  "goog_dwVeOzYwZipIhrUNGWlyMTdqCWi";

/**
 * iOS-only proof secret for V1 free monetization HMAC.
 * Prefer KRISTO_IOS_V1_FREE_PROOF_SECRET (EAS iOS / Metro env).
 * Local Metro: fall back to ~/.cursor/kristo-ios-v1-free-proof.secret so
 * Constants.extra gets the real key (not DEV_FALLBACK) without manual export.
 * Never bake into Android builds (EAS_BUILD_PLATFORM=android strips it).
 */
function resolveIosV1FreeProofSecret() {
  if (process.env.EAS_BUILD_PLATFORM === "android") return "";
  const fromEnv = String(process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  // EAS cloud builders must use env/secrets — do not read a host home file there.
  if (process.env.EAS_BUILD) return "";
  try {
    const localPath = path.join(os.homedir(), ".cursor", "kristo-ios-v1-free-proof.secret");
    const fromFile = String(fs.readFileSync(localPath, "utf8") || "").trim();
    return fromFile;
  } catch {
    return "";
  }
}

const IOS_V1_FREE_PROOF_SECRET = resolveIosV1FreeProofSecret();

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...expo.extra,
      revenuecatAndroidApiKey: REVENUECAT_ANDROID_API_KEY,
      ...(IOS_V1_FREE_PROOF_SECRET
        ? { iosV1FreeProofSecret: IOS_V1_FREE_PROOF_SECRET }
        : {}),
    },
    ios: {
      ...expo.ios,
      supportsTablet: false,
      infoPlist: {
        ...expo.ios.infoPlist,
        NSLocalNetworkUsageDescription:
          "Kristo needs local network access to connect to the Metro bundler during development.",
        NSBonjourServices: ["_expo._tcp"],
      },
    },
    plugins: [
      ...(expo.plugins || []),
      "@react-native-community/datetimepicker",
      "expo-asset",
      "expo-audio",
      [
        "expo-dev-client",
        {
          launchMode: "launcher",
        },
      ],
      "./plugins/withDevClientMetroPort",
      ...(isProductionEasBuild ? ["./plugins/withAndroidProductionAbis"] : []),
    ],
  },
};
