// EAS build hook: copy the Firebase config for Kristo push into the Android project.
// Only builds whose EAS environment defines the GOOGLE_SERVICES_JSON file variable (the test
// development environment) get it; every other build is left without Firebase.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.env.GOOGLE_SERVICES_JSON;
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "google-services.json");

if (!source) {
  console.log("[eas-google-services] GOOGLE_SERVICES_JSON not set; building without Firebase push.");
} else if (!existsSync(source)) {
  console.error("[eas-google-services] GOOGLE_SERVICES_JSON points to a missing file.");
  process.exit(1);
} else {
  copyFileSync(source, target);
  console.log("[eas-google-services] google-services.json installed for this build.");
}
