const { withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

/**
 * Kristo push is Android-only for now, but prebuild applies the expo-notifications and
 * expo-task-manager plugins on their own (the packages are installed for Android):
 * - expo-notifications adds `aps-environment`; the App Store provisioning profile has no Push
 *   Notifications capability, so the iOS build fails;
 * - expo-task-manager adds the `fetch` background mode, which iOS never uses.
 * Plugins listed in app.config run after the built-in ones, so this removes both again (iOS only).
 * With KRISTO_IOS_VOIP_PUSH=1 (VoIP push set up, see withIosCalls) the push entitlement stays.
 */
module.exports = function withoutIosPushCapabilities(config) {
  config = withEntitlementsPlist(config, (configMod) => {
    if (process.env.KRISTO_IOS_VOIP_PUSH !== "1") delete configMod.modResults["aps-environment"];
    return configMod;
  });
  return withInfoPlist(config, (configMod) => {
    const modes = configMod.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const kept = modes.filter((mode) => mode !== "fetch");
      if (kept.length) configMod.modResults.UIBackgroundModes = kept;
      else delete configMod.modResults.UIBackgroundModes;
    }
    return configMod;
  });
};
