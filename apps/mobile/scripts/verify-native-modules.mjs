#!/usr/bin/env node
/**
 * Verifies JS packages, CocoaPods lockfile, and local Pods headers agree for
 * modules that commonly cause "Cannot find native module" after a stale dev build.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function sh(cmd, cwd = root) {
  return execSync(cmd, { cwd, encoding: "utf8" }).trim();
}

const required = [
  { js: "expo-video", pod: "ExpoVideo" },
  { js: "expo-image", pod: "ExpoImage" },
  { js: "expo-image-manipulator", pod: "ExpoImageManipulator" },
  { js: "expo-print", pod: "ExpoPrint" },
  { js: "react-native-reanimated", pod: "RNReanimated" },
];

const lock = readJson("package-lock.json");
const pkg = readJson("package.json");
const podLockPath = path.join(root, "ios/Podfile.lock");
const podLock = fs.existsSync(podLockPath) ? fs.readFileSync(podLockPath, "utf8") : "";
const headersDir = path.join(root, "ios/Pods/Headers/Public");

console.log("Kristo native module verification\n");

let ok = true;

for (const mod of required) {
  const jsVersion =
    lock.packages?.[`node_modules/${mod.js}`]?.version ||
    pkg.dependencies?.[mod.js] ||
    "missing";
  const podListed = new RegExp(`- ${mod.pod} \\(`).test(podLock);
  const headerExists = fs.existsSync(path.join(headersDir, mod.pod));

  const line = [
    mod.js.padEnd(24),
    `js=${jsVersion}`.padEnd(14),
    `podlock=${podListed ? "yes" : "NO"}`.padEnd(12),
    `headers=${headerExists ? "yes" : "NO"}`,
  ].join(" ");

  if (!podListed || jsVersion === "missing") ok = false;
  console.log(line);
}

const reanimatedPkg = readJson("node_modules/react-native-reanimated/package.json");
const reanimatedPod = podLock.match(/- RNReanimated \(([^)]+)\)/)?.[1] || "unknown";
console.log("");
console.log(`Reanimated JS package: ${reanimatedPkg.version}`);
console.log(`Reanimated Podfile.lock: ${reanimatedPod}`);
if (reanimatedPkg.version !== reanimatedPod) {
  ok = false;
  console.log("MISMATCH: rebuild the iOS dev client after `npm run ios:pods`.");
}

console.log("");
if (!fs.existsSync(podLockPath)) {
  ok = false;
  console.log("Missing ios/Podfile.lock — run `npx expo prebuild` then `npm run ios:pods`.");
}

if (ok) {
  console.log("Local native tree looks consistent.");
  console.log("If Metro still reports missing native modules, the installed dev client is stale:");
  console.log("  npm run ios:rebuild:dev");
  console.log("  # or EAS: eas build --profile development --platform ios");
} else {
  console.log("Fix native deps, then rebuild the dev client.");
  process.exit(1);
}
