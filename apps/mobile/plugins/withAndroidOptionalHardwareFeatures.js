const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * Google Play turns some permissions and manifest settings into *required* hardware features
 * ("implied features") and hides the app from devices without them:
 * - CAMERA -> android.hardware.camera + android.hardware.camera.autofocus
 * - RECORD_AUDIO -> android.hardware.microphone
 * - BLUETOOTH / BLUETOOTH_ADMIN -> android.hardware.bluetooth
 * - MainActivity screenOrientation="portrait" -> android.hardware.screen.portrait
 * Kristo works without them (camera / microphone / calls are optional features of the app), so
 * they are declared as not required. Android only; iOS is not affected.
 */
const OPTIONAL_FEATURES = [
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.microphone",
  "android.hardware.bluetooth",
  "android.hardware.screen.portrait",
];

function withAndroidOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (configMod) => {
    const manifest = configMod.modResults.manifest;
    const features = Array.isArray(manifest["uses-feature"]) ? manifest["uses-feature"] : [];
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((feature) => feature?.$?.["android:name"] === name);
      if (existing) {
        existing.$["android:required"] = "false";
      } else {
        features.push({ $: { "android:name": name, "android:required": "false" } });
      }
    }
    manifest["uses-feature"] = features;
    return configMod;
  });
}

module.exports = withAndroidOptionalHardwareFeatures;
module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
