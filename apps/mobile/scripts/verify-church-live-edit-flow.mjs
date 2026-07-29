/**
 * Verify Church Live / ministry room Edit no longer uses the Coming-next placeholder.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesPath = path.join(
  __dirname,
  "../app/(tabs)/more/my-church-room/messages/[id].tsx"
);
const src = fs.readFileSync(messagesPath, "utf8");

const failures = [];

if (!src.includes("KRISTO_STRUCTURED_PROFILE_EDIT_OPEN")) {
  failures.push("missing KRISTO_STRUCTURED_PROFILE_EDIT_OPEN open log");
}
if (!src.includes('/(tabs)/church/ministries/[ministryId]/edit')) {
  failures.push("missing ministry edit route wiring");
}
if (!src.includes('/(tabs)/church/edit')) {
  failures.push("missing church edit route wiring for church-media-room");
}
if (!src.includes('action === "edit"')) {
  failures.push("missing edit action handler");
}

const editPauseCombo = /if\s*\(\s*action\s*===\s*"edit"\s*\|\|\s*action\s*===\s*"pause"\s*\)/;
if (editPauseCombo.test(src)) {
  failures.push("edit still combined with pause Coming-next placeholder");
}

const editBlockMatch = src.match(
  /if\s*\(\s*action\s*===\s*"edit"\s*\)\s*\{([\s\S]*?)\n\s*if\s*\(\s*action\s*===\s*"pause"/
);
if (!editBlockMatch) {
  failures.push("could not isolate edit handler block before pause");
} else if (/Coming next/.test(editBlockMatch[1])) {
  failures.push("edit handler still shows Coming next placeholder");
} else if (!/returnParams/.test(editBlockMatch[1])) {
  failures.push("edit handler missing returnParams for room restore");
}

if (failures.length) {
  console.error("VERIFY_EDIT_FLOW_FAIL");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("VERIFY_EDIT_FLOW_OK", {
  file: "apps/mobile/app/(tabs)/more/my-church-room/messages/[id].tsx",
  ministryEdit: true,
  churchLiveEdit: true,
  placeholderRemovedFromEdit: true,
});
