#!/usr/bin/env node
/**
 * Attach the Kristo iOS dev client on a physical device to Metro.
 * Usage: node scripts/attach-ios-dev-client.mjs [deviceName]
 */
import { execSync } from "node:child_process";

const deviceName = process.argv[2] || "BOYKID";
const metroPort = process.env.KRISTO_METRO_PORT || "8084";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const lanIp = sh("/usr/sbin/ipconfig getifaddr en0");
const metroUrl = `http://${lanIp}:${metroPort}`;
const encodedUrl = encodeURIComponent(metroUrl);
const payloadUrl = `exp+mobile://expo-development-client/?url=${encodedUrl}`;

console.log(`Metro URL: ${metroUrl}`);
console.log(`Dev client payload: ${payloadUrl}`);
console.log("");
console.log("1. Force-quit Kristo on the iPhone.");
console.log("2. Ensure Metro is running: npm run start:dev");
console.log("3. If the dev launcher appears, enter the Metro URL above and tap Connect.");
console.log("   (Auto-discovery only scans localhost and the router — not this Mac.)");
console.log("4. Allow Local Network access if iOS prompts.");
console.log("");

try {
  sh(
    `xcrun devicectl device process launch -d ${JSON.stringify(deviceName)} com.princefariji.kristoapp --payload-url ${JSON.stringify(payloadUrl)}`
  );
  console.log(`Launched ${deviceName} with Metro deep link.`);
} catch (error) {
  console.error("devicectl launch failed. Unlock the iPhone, then open Kristo manually from the home screen.");
  console.error("In the dev launcher, enter the Metro URL above and tap Connect.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}
