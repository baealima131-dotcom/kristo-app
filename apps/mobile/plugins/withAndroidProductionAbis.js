const { withGradleProperties } = require("@expo/config-plugins");

/**
 * Production Android: ARM native ABIs + larger Gradle heap for dex merge.
 * armeabi-v7a is included for phones that run a 32-bit Android (e.g. Android Go devices with
 * 2 GB RAM such as Infinix SMART 10 HD): an arm64-only bundle is "not compatible" for them on
 * Google Play. Play splits the bundle per ABI, so arm64 phones download only their own libs.
 */
module.exports = function withAndroidProductionAbis(config) {
  if (process.env.EAS_BUILD_PROFILE !== "production") {
    return config;
  }

  return withGradleProperties(config, (config) => {
    const productionGradleProperties = {
      reactNativeArchitectures: "armeabi-v7a,arm64-v8a",
      "org.gradle.jvmargs":
        "-Xmx6144m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8",
    };

    for (const [key, value] of Object.entries(productionGradleProperties)) {
      config.modResults = config.modResults.filter(
        (item) => item.type !== "property" || item.key !== key
      );
      config.modResults.push({ type: "property", key, value });
    }

    return config;
  });
};
