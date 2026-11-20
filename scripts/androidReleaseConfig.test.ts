import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const mobileDir = path.join(process.cwd(), "apps/mobile");
const read = (p: string) => fs.readFileSync(path.join(mobileDir, p), "utf8");
const require = createRequire(path.join(mobileDir, "package.json"));

function loadAppConfig(profile?: string) {
  const configPath = path.join(mobileDir, "app.config.js");
  const previous = process.env.EAS_BUILD_PROFILE;
  if (profile === undefined) delete process.env.EAS_BUILD_PROFILE;
  else process.env.EAS_BUILD_PROFILE = profile;
  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath).expo;
  } finally {
    if (previous === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = previous;
  }
}

const pluginNames = (expo: any) => (expo.plugins || []).map((p: any) => (Array.isArray(p) ? p[0] : p));

test("production Android ships armeabi-v7a and arm64-v8a (32-bit Android phones are compatible)", () => {
  const plugin = read("plugins/withAndroidProductionAbis.js");
  assert.match(plugin, /reactNativeArchitectures: "armeabi-v7a,arm64-v8a"/);
  assert.doesNotMatch(plugin, /reactNativeArchitectures: "arm64-v8a"/);
  // Still production-only, and the larger Gradle heap stays.
  assert.match(plugin, /process\.env\.EAS_BUILD_PROFILE !== "production"/);
  assert.match(plugin, /-Xmx6144m/);
  assert.ok(pluginNames(loadAppConfig("production")).includes("./plugins/withAndroidProductionAbis"));
  assert.ok(!pluginNames(loadAppConfig("preview")).includes("./plugins/withAndroidProductionAbis"));
});

test("camera, microphone, bluetooth and portrait are optional Play Store features", () => {
  const { OPTIONAL_FEATURES } = require("./plugins/withAndroidOptionalHardwareFeatures");
  assert.deepEqual(OPTIONAL_FEATURES, [
    "android.hardware.camera",
    "android.hardware.camera.autofocus",
    "android.hardware.microphone",
    "android.hardware.bluetooth",
    "android.hardware.screen.portrait",
  ]);
  const plugin = read("plugins/withAndroidOptionalHardwareFeatures.js");
  assert.match(plugin, /"android:required"\] = "false"/);
  assert.match(plugin, /"android:required": "false"/);
  // Android manifest only: nothing on the iOS side.
  assert.doesNotMatch(plugin, /withInfoPlist|withXcodeProject|withEntitlementsPlist|withPodfile/);
  for (const profile of [undefined, "preview", "production"]) {
    assert.ok(pluginNames(loadAppConfig(profile)).includes("./plugins/withAndroidOptionalHardwareFeatures"));
  }
});

test("expo-face-detector is gone (unused; its native lib was the only one without 16 KB alignment)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies?.["expo-face-detector"], undefined);
  assert.equal(pkg.devDependencies?.["expo-face-detector"], undefined);
  assert.doesNotMatch(read("package-lock.json"), /expo-face-detector/);
  for (const dir of ["app", "src", "plugins"]) {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
      );
    for (const file of walk(path.join(mobileDir, dir)).filter((f) => /\.(t|j)sx?$/.test(f))) {
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), /expo-face-detector/, file);
    }
  }
});

test("next Android build is 1.0.8 (118); iOS version numbers unchanged", () => {
  const app = JSON.parse(read("app.json")).expo;
  const gradle = read("android/app/build.gradle");
  const eas = JSON.parse(read("eas.json"));
  assert.equal(app.version, "1.0.8");
  assert.equal(app.android.versionCode, 117);
  assert.match(gradle, /versionCode 117\n\s+versionName "1\.0\.8"/);
  // 117 is already published; EAS autoIncrement (local version source) bumps it to 118.
  assert.equal(eas.cli.appVersionSource, "local");
  assert.equal(eas.build.production.autoIncrement, true);
  assert.equal(app.ios.buildNumber, "18");
});
