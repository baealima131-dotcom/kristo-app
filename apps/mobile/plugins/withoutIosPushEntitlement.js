const { withEntitlementsPlist } = require("@expo/config-plugins");

/**
 * Kristo push is Android-only for now, but prebuild applies the expo-notifications plugin on its
 * own (the package is installed), which adds `aps-environment` to the iOS entitlements. The App
 * Store provisioning profile has no Push Notifications capability, so the iOS build fails.
 * Plugins listed in app.config run after the built-in ones, so this removes the entitlement again.
 * Delete this plugin when iOS push (APNs) is set up.
 */
module.exports = function withoutIosPushEntitlement(config) {
  return withEntitlementsPlist(config, (configMod) => {
    delete configMod.modResults["aps-environment"];
    return configMod;
  });
};
