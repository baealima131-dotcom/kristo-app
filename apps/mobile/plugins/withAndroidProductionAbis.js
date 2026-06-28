const { withGradleProperties } = require("@expo/config-plugins");

/** Production Android: ARM64-only native ABIs + larger Gradle heap for dex merge. */
module.exports = function withAndroidProductionAbis(config) {
  if (process.env.EAS_BUILD_PROFILE !== "production") {
    return config;
  }

  return withGradleProperties(config, (config) => {
    const productionGradleProperties = {
      reactNativeArchitectures: "arm64-v8a",
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
