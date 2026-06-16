const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const STOREKIT_SOURCE = "storekit/KristoSubscriptions.storekit";
const IOS_STOREKIT_NAME = "KristoSubscriptions.storekit";
const SCHEME_RELATIVE = `../../../${IOS_STOREKIT_NAME}`;

function copyStoreKitFile(projectRoot, iosProjectRoot) {
  const source = path.join(projectRoot, STOREKIT_SOURCE);
  const target = path.join(iosProjectRoot, IOS_STOREKIT_NAME);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing StoreKit config: ${source}`);
  }

  fs.mkdirSync(iosProjectRoot, { recursive: true });
  fs.copyFileSync(source, target);
}

function patchSchemeStoreKitReference(schemePath) {
  if (!fs.existsSync(schemePath)) return false;

  let xml = fs.readFileSync(schemePath, "utf8");
  const block = `<StoreKitConfigurationFileReference
         identifier = "${SCHEME_RELATIVE}">
      </StoreKitConfigurationFileReference>`;

  if (xml.includes("StoreKitConfigurationFileReference")) {
    xml = xml.replace(
      /<StoreKitConfigurationFileReference[\s\S]*?<\/StoreKitConfigurationFileReference>/,
      block
    );
  } else {
    xml = xml.replace(
      /<\/BuildableProductRunnable>\s*(?=<\/LaunchAction>)/,
      `</BuildableProductRunnable>\n      ${block}\n`
    );
  }

  fs.writeFileSync(schemePath, xml);
  return true;
}

function findSchemeFiles(xcodeprojRoot) {
  const shared = path.join(xcodeprojRoot, "xcshareddata", "xcschemes");
  if (!fs.existsSync(shared)) return [];

  return fs
    .readdirSync(shared)
    .filter((name) => name.endsWith(".xcscheme"))
    .map((name) => path.join(shared, name));
}

/** Wire local StoreKit config (14-day monthly trial) into the iOS Run scheme. */
module.exports = function withStoreKitConfiguration(config) {
  return withDangerousMod(config, [
    "ios",
    async (configMod) => {
      const projectRoot = configMod.modRequest.projectRoot;
      const iosProjectRoot = configMod.modRequest.platformProjectRoot;
      const projectName = configMod.modRequest.projectName;

      copyStoreKitFile(projectRoot, iosProjectRoot);

      const schemePaths = findSchemeFiles(path.join(iosProjectRoot, `${projectName}.xcodeproj`));
      for (const schemePath of schemePaths) {
        patchSchemeStoreKitReference(schemePath);
      }

      return configMod;
    },
  ]);
};
