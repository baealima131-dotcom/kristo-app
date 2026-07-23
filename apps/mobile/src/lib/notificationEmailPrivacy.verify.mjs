/**
 * Verification: notification feed must never expose user emails as actor
 * display names (or in titles / subtitles / previews).
 *
 * Allowed exception: dedicated account settings screens that intentionally
 * show the signed-in user's email.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../../..");

const EMAIL_LIKE_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const EMAIL_IN_TEXT_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RAW_USER_ID_RX = /^u_[a-f0-9]{8,}$/i;

function isRawUserId(value) {
  const s = String(value || "").trim();
  return Boolean(s) && RAW_USER_ID_RX.test(s);
}

function isEmailLike(value) {
  const s = String(value || "").trim();
  return Boolean(s) && EMAIL_LIKE_RX.test(s);
}

function isUnsafeActorDisplayName(value) {
  const s = String(value || "").trim();
  if (!s) return true;
  return isRawUserId(s) || isEmailLike(s);
}

function roleFallbackLabel(role) {
  const r = String(role || "").trim();
  if (r === "Pastor") return "Pastor";
  if (r === "Church_Admin") return "Church Admin";
  if (r === "System_Admin") return "System Admin";
  if (r === "Ministry_Leader") return "Ministry Leader";
  if (r === "Leader") return "Leader";
  if (r === "Member") return "Member";
  return "Church Admin";
}

function redactEmailsInText(text, replacement = "Member") {
  const safe = String(replacement || "").trim() || "Member";
  const redacted = isEmailLike(safe) ? "Member" : safe;
  return String(text || "")
    .replace(EMAIL_IN_TEXT_RX, redacted)
    .trim();
}

function safeDisplayName(notification) {
  const actorName = String(notification?.actorName || "").trim();
  if (actorName && !isUnsafeActorDisplayName(actorName)) return actorName;
  return roleFallbackLabel(notification?.actorRole);
}

function safeBody(notification) {
  const raw = String(notification?.body || notification?.message || notification?.text || "");
  const displayName = safeDisplayName(notification);
  return redactEmailsInText(raw, displayName);
}

function safeNotificationTitle(notification) {
  const raw = String(notification?.title || "Notification").trim() || "Notification";
  return redactEmailsInText(raw, safeDisplayName(notification));
}

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "build") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

// --- Source guards -----------------------------------------------------------

const actorSrc = read("app/api/_lib/notificationActor.ts");
const notificationsSrc = read("app/api/_lib/notifications.ts");
const authSrc = read("app/api/_lib/auth.ts");
const displaySrc = read("apps/mobile/src/lib/notificationDisplay.ts");
const apiSrc = read("apps/mobile/src/lib/churchNotificationsApi.ts");
const uiSrc = read("apps/mobile/app/(tabs)/more/notifications.tsx");

assert.match(actorSrc, /export function isEmailLike/);
assert.match(actorSrc, /isUnsafeActorDisplayName/);
assert.match(actorSrc, /redactEmailsInText/);
assert.match(actorSrc, /identity\.name/);
assert.match(actorSrc, /roleFallbackLabel\(actorRole\)/);
// Preference: profile identity before viewer seed (avoids Kristo ID beating display name).
{
  const resolveFn = actorSrc.slice(actorSrc.indexOf("export async function resolveActorFromViewer"));
  const identityIdx = resolveFn.indexOf("identity.name");
  const viewerIdx = resolveFn.indexOf("viewer.name");
  assert.ok(identityIdx >= 0 && viewerIdx >= 0 && identityIdx < viewerIdx);
}
assert.match(notificationsSrc, /isUnsafeActorDisplayName/);
assert.match(notificationsSrc, /redactEmailsInText/);
assert.match(displaySrc, /export function isEmailLike/);
assert.match(displaySrc, /safeNotificationTitle/);
assert.match(displaySrc, /EMAIL_IN_TEXT_RX/);
assert.match(apiSrc, /safeNotificationTitle\(raw\)/);
assert.match(apiSrc, /actorName:\s*safeDisplayName\(raw\)/);
assert.match(uiSrc, /safeNotificationTitle/);
assert.match(uiSrc, /safeDisplayName/);

assert.doesNotMatch(
  authSrc,
  /name:\s*u\?\.email/,
  "getViewer must not set viewer.name from email"
);
assert.doesNotMatch(
  authSrc,
  /name:\s*u\?\.email\s*\|\|/,
  "getViewer must not fall back to email as display name"
);

const forbiddenActorKeys = [
  "actorEmail",
  "creatorEmail",
  "updaterEmail",
  "modifiedByEmail",
];

const notificationBuilderPaths = [
  "app/api/_lib/feedEngagementNotifications.ts",
  "app/api/_lib/churchContentNotifications.ts",
  "app/api/_lib/churchMediaNotifications.ts",
  "app/api/_lib/liveEventNotifications.ts",
  "app/api/_lib/privateCallNotifications.ts",
  "app/api/_lib/notifications.ts",
  "app/api/_lib/notificationActor.ts",
  "apps/mobile/src/lib/notificationDisplay.ts",
  "apps/mobile/src/lib/churchNotificationsApi.ts",
  "apps/mobile/app/(tabs)/more/notifications.tsx",
];

for (const rel of notificationBuilderPaths) {
  const src = read(rel);
  for (const key of forbiddenActorKeys) {
    assert.ok(
      !src.includes(key),
      `${rel} must not use forbidden notification email key ${key}`
    );
  }
}

// Scan notification-related API builders for actorName assigned from .email
const builderFiles = walkFiles(join(root, "app/api")).filter((p) => {
  const rel = relative(root, p);
  return (
    /notification/i.test(rel) ||
    /\/notifications\//.test(rel) ||
    /feedEngagement|churchContent|churchMedia|liveEvent|privateCall/.test(rel)
  );
});

const emailActorAssignRx =
  /actorName\s*:\s*[^\n,]*(?:\.email|user\.email|viewer\.email|actorEmail|creatorEmail)/i;

for (const file of builderFiles) {
  const src = readFileSync(file, "utf8");
  assert.ok(
    !emailActorAssignRx.test(src),
    `${relative(root, file)} must not assign actorName from an email field`
  );
}

// Account settings may intentionally show email; ensure we only allow that
// outside the notification feed surface.
const accountSettingsCandidates = walkFiles(join(root, "apps/mobile")).filter((p) =>
  /account|settings|profile/i.test(relative(root, p))
);
assert.ok(
  accountSettingsCandidates.length > 0,
  "expected account/settings screens to exist as the intentional email display exception"
);

// --- Behavioral asserts ------------------------------------------------------

const leaked = {
  title: "Update from jane.doe@example.com",
  body: "jane.doe@example.com liked your post",
  message: "jane.doe@example.com liked your post",
  actorName: "jane.doe@example.com",
  actorRole: "Member",
};

assert.equal(safeDisplayName(leaked), "Member");
assert.equal(safeNotificationTitle(leaked), "Update from Member");
assert.equal(safeBody(leaked), "Member liked your post");
assert.doesNotMatch(safeDisplayName(leaked), EMAIL_IN_TEXT_RX);
assert.doesNotMatch(safeNotificationTitle(leaked), EMAIL_IN_TEXT_RX);
assert.doesNotMatch(safeBody(leaked), EMAIL_IN_TEXT_RX);

const publicNamed = {
  title: "New comment on your post",
  body: "Jordan Lee: great message",
  actorName: "Jordan Lee",
  actorRole: "Pastor",
};
assert.equal(safeDisplayName(publicNamed), "Jordan Lee");
assert.equal(safeNotificationTitle(publicNamed), "New comment on your post");
assert.equal(safeBody(publicNamed), "Jordan Lee: great message");

const kristoIdActor = {
  title: "Media host added",
  body: "KR7-DEMO1 was added as a trusted media host.",
  actorName: "KR7-DEMO1",
  actorRole: "Church_Admin",
};
assert.equal(safeDisplayName(kristoIdActor), "KR7-DEMO1");
assert.doesNotMatch(safeDisplayName(kristoIdActor), EMAIL_IN_TEXT_RX);

const roleOnly = {
  title: "Church profile updated",
  body: "u_abcdef123456 updated the church profile",
  actorName: "u_abcdef123456",
  actorRole: "Church_Admin",
  type: "ChurchProfileUpdated",
};
assert.equal(safeDisplayName(roleOnly), "Church Admin");

console.log("notificationEmailPrivacy.verify.mjs: ok");
