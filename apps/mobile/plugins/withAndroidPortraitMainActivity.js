const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

/**
 * app.json uses `orientation: "default"` so iOS Info.plist lists landscape (needed
 * for Watch fullscreen). Keep Android MainActivity portrait at launch; Watch
 * unlocks rotation at runtime via expo-screen-orientation.
 */
module.exports = function withAndroidPortraitMainActivity(config) {
  return withAndroidManifest(config, (configMod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(configMod.modResults);
    activity.$["android:screenOrientation"] = "portrait";
    return configMod;
  });
};
