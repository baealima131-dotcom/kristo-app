/** @type {import('expo/config').ExpoConfig} */
const appJson = require("./app.json");

const expo = appJson.expo;
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";

module.exports = {
  expo: {
    ...expo,
    ios: {
      ...expo.ios,
      infoPlist: {
        ...expo.ios.infoPlist,
        NSLocalNetworkUsageDescription:
          "Kristo needs local network access to connect to the Metro bundler during development.",
        NSBonjourServices: ["_expo._tcp"],
      },
    },
    plugins: [
      ...(expo.plugins || []),
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
