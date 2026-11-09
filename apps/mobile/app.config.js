/** @type {import('expo/config').ExpoConfig} */
const appJson = require("./app.json");

const expo = appJson.expo;
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...expo.extra,
      // iOS incoming calls over VoIP push; see plugins/withIosCalls.
      kristoIosVoipPush: process.env.KRISTO_IOS_VOIP_PUSH === "1",
    },
    ios: {
      ...expo.ios,
      supportsTablet: false,
      infoPlist: {
        ...expo.ios.infoPlist,
        NSLocalNetworkUsageDescription:
          "Kristo needs local network access to connect to the Metro bundler during development.",
        NSBonjourServices: ["_expo._tcp"],
        NSLocationWhenInUseUsageDescription:
          "Kristo uses your location to identify the city, region and country for your SOKO seller application.",
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
      "./plugins/withAndroidPortraitMainActivity",
      "./plugins/withoutIosPushCapabilities",
      "./plugins/withIosCalls",
      ...(isProductionEasBuild ? ["./plugins/withAndroidProductionAbis"] : []),
    ],
  },
};
