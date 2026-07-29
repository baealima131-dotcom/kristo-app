/** @type {import('expo/config').ExpoConfig} */
const appJson = require("./app.json");

const expo = appJson.expo;
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";

const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
  expo.extra?.revenuecatAndroidApiKey ||
  "goog_dwVeOzYwZipIhrUNGWlyMTdqCWi";

// iOS-only proof secret for V1 free monetization HMAC.
// Set KRISTO_IOS_V1_FREE_PROOF_SECRET on the iOS EAS profile / secrets only.
// Never bake into Android builds (EAS_BUILD_PLATFORM=android strips it).
// Residual risk: extractable from IPA; App Attest is the V1.5 hardening path.
const IOS_V1_FREE_PROOF_SECRET =
  process.env.EAS_BUILD_PLATFORM === "android"
    ? ""
    : String(process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET || "").trim();

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
