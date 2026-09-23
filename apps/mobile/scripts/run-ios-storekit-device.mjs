#!/usr/bin/env node
/**
 * Launch KristoApp on a physical device FROM Xcode so the scheme's
 * StoreKitConfigurationFileReference (KristoSubscriptions.storekit) is active.
 *
 * expo run:ios / home-screen relaunch does NOT enable StoreKit Testing — products
 * then come from App Store Connect sandbox and often return empty offerings.
 *
 * Usage: node scripts/run-ios-storekit-device.mjs [deviceName]
 * Default device: BOYKID
 */
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const workspace = path.join(mobileRoot, "ios", "KristoApp.xcworkspace");
const deviceName = process.argv[2] || "BOYKID";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const lanIp = sh("/usr/sbin/ipconfig getifaddr en0");
console.log(`Device: ${deviceName}`);
console.log(`Workspace: ${workspace}`);
console.log(`Metro expected: http://${lanIp}:8084`);
console.log("");
console.log("Opening Xcode and requesting Run (⌘R) with StoreKit config from KristoApp scheme…");
console.log("Keep Metro running: npx expo start --dev-client --clear --lan --port 8084");
console.log("Do NOT quit the app and reopen from the home screen — that drops StoreKit Testing.");
console.log("");

spawnSync("open", ["-a", "Xcode", workspace], { stdio: "inherit" });

const appleScript = `
tell application "Xcode"
  activate
end tell
delay 4
tell application "System Events"
  tell process "Xcode"
    set frontmost to true
    -- Product → Destination is chosen manually if needed; then Run
    keystroke "r" using command down
  end tell
end tell
`;

const result = spawnSync("osascript", ["-e", appleScript], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "osascript failed");
  console.error("");
  console.error("Manual steps:");
  console.error("1. Xcode → KristoApp scheme → Edit Scheme → Run → Options");
  console.error("2. StoreKit Configuration = KristoSubscriptions.storekit");
  console.error(`3. Destination = ${deviceName}`);
  console.error("4. Product → Run (⌘R)");
  process.exit(1);
}

console.log("Xcode Run triggered. Unlock the iPhone if prompted.");
console.log("After launch, open Media Premium / Subscribe Monthly and confirm offerings load.");
