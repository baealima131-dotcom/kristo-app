/** @type {import('expo/config').ExpoConfig} */
const appJson = require("./app.json");

const expo = appJson.expo;
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";

const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
  expo.extra?.revenuecatAndroidApiKey ||
  "goog_dwVeOzYwZipIhrUNGWlyMTdqCWi";

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...expo.extra,
      revenuecatAndroidApiKey: REVENUECAT_ANDROID_API_KEY,
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
      "expo-secure-store",
      "expo-local-authentication",
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
