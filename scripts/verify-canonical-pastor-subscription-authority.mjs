#!/usr/bin/env node
/**
 * Focused verification: singular canonical Pastor subscription authority.
 *
 * Mirrors evaluateChurchMediaAccess / GET side-effect gates / lock allowMutation
 * after the hardening change. Does NOT hit a live DB.
 */

function normalizeChurchRoleToken(value) {
  return String(value || "").trim().toLowerCase();
}
function isPastorChurchRole(value) {
  const n = normalizeChurchRoleToken(value);
  return n === "pastor" || n.includes("pastor");
}
function isExactPastorRole(value) {
  return normalizeChurchRoleToken(value) === "pastor";
}
function isAssistantOrCoPastorRole(value) {
  const n = normalizeChurchRoleToken(value);
  return (
    n.includes("assistant") ||
    n.includes("co-pastor") ||
    n.includes("copastor") ||
    n.includes("co pastor")
  );
}
function normalizeMemberUserId(value) {
  return String(value || "").trim();
}
function userIdsMatch(a, b) {
  const left = normalizeMemberUserId(a).toLowerCase();
  const right = normalizeMemberUserId(b).toLowerCase();
  return Boolean(left && right && left === right);
}

function resolveActualChurchPastorUserId(members) {
  const exact = members.find((row) => isExactPastorRole(row.churchRole));
  if (exact) return normalizeMemberUserId(exact.userId);
  const primary = members.find(
    (row) => isPastorChurchRole(row.churchRole) && !isAssistantOrCoPastorRole(row.churchRole)
  );
  if (primary) return normalizeMemberUserId(primary.userId);
  const anyPastor = members.find((row) => isPastorChurchRole(row.churchRole));
  return normalizeMemberUserId(anyPastor?.userId);
}

function evaluateAccess({ members, userId, hostUserIds = [], subscriptionActive = false }) {
  const actualPastorUserId = resolveActualChurchPastorUserId(members);
  const membership = members.find((m) => userIdsMatch(m.userId, userId)) || null;
  const hasPastorRole = isPastorChurchRole(membership?.churchRole);
  const isActualChurchPastor = Boolean(
    userId && actualPastorUserId && userIdsMatch(userId, actualPastorUserId)
  );
  const isMediaHost = hostUserIds.some((id) => userIdsMatch(id, userId));
  const canManageMediaHosts = isActualChurchPastor;
  const canManageChurchSubscription = isActualChurchPastor;
  const canOpenMediaScreen = isActualChurchPastor || hasPastorRole || isMediaHost;
  const canUseMediaTools = subscriptionActive && canOpenMediaScreen;
  return {
    actualPastorUserId,
    hasPastorRole,
    isActualChurchPastor,
    isMediaHost,
    canManageMediaHosts,
    canManageChurchSubscription,
    canOpenMediaScreen,
    canUseMediaTools,
  };
}

/** Mirrors GET /api/church/media write-side-effect gates. */
function getMediaSideEffects(access) {
  return {
    mayReconcileSubscriptionSource: access.canManageChurchSubscription === true,
    mayMutateOwnershipLock: access.canManageChurchSubscription === true,
    maySyncActivate: access.canManageChurchSubscription === true,
    mayManageMediaHosts: access.canManageMediaHosts === true,
    mayPurchase: access.isActualChurchPastor === true,
  };
}

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

const CANONICAL = "u_canonical_pastor";
const ASSISTANT = "u_assistant_pastor";
const HOST = "u_media_host";
const MEMBER = "u_regular_member";

const members = [
  { userId: ASSISTANT, churchRole: "Assistant Pastor" },
  { userId: CANONICAL, churchRole: "Pastor" },
  { userId: MEMBER, churchRole: "Member" },
];

console.log("[1] canonical pastor resolution prefers exact Pastor over Assistant");
check(
  "canonical id is exact Pastor (not first assistant)",
  resolveActualChurchPastorUserId(members) === CANONICAL
);

console.log("[2] canonical pastor can purchase / activate / manage");
const pastor = evaluateAccess({
  members,
  userId: CANONICAL,
  hostUserIds: [HOST],
  subscriptionActive: true,
});
const pastorFx = getMediaSideEffects(pastor);
check("pastor isActualChurchPastor", pastor.isActualChurchPastor === true);
check("pastor canManageChurchSubscription", pastor.canManageChurchSubscription === true);
check("pastor canManageMediaHosts", pastor.canManageMediaHosts === true);
check("pastor may purchase", pastorFx.mayPurchase === true);
check("pastor may sync activate", pastorFx.maySyncActivate === true);
check("pastor may mutate lock", pastorFx.mayMutateOwnershipLock === true);
check("pastor may reconcile source", pastorFx.mayReconcileSubscriptionSource === true);
check("pastor may manage hosts", pastorFx.mayManageMediaHosts === true);
check("pastor canUseMediaTools", pastor.canUseMediaTools === true);

console.log("[3] assistant/co-pastor cannot purchase or manage");
const assistant = evaluateAccess({
  members,
  userId: ASSISTANT,
  hostUserIds: [HOST],
  subscriptionActive: true,
});
const assistantFx = getMediaSideEffects(assistant);
check("assistant hasPastorRole", assistant.hasPastorRole === true);
check("assistant NOT isActualChurchPastor", assistant.isActualChurchPastor === false);
check("assistant cannot manage subscription", assistant.canManageChurchSubscription === false);
check("assistant cannot purchase", assistantFx.mayPurchase === false);
check("assistant cannot sync", assistantFx.maySyncActivate === false);
check("assistant cannot mutate lock", assistantFx.mayMutateOwnershipLock === false);
check("assistant cannot manage hosts", assistantFx.mayManageMediaHosts === false);
check("assistant may open media screen (non-subscription)", assistant.canOpenMediaScreen === true);
check(
  "assistant tools allowed when sub active (non-management)",
  assistant.canUseMediaTools === true
);

console.log("[4] media host GET is read-only; tools still work when active");
const host = evaluateAccess({
  members,
  userId: HOST,
  hostUserIds: [HOST],
  subscriptionActive: true,
});
const hostFx = getMediaSideEffects(host);
check("host isMediaHost", host.isMediaHost === true);
check("host canUseMediaTools", host.canUseMediaTools === true);
check("host GET no source reconcile", hostFx.mayReconcileSubscriptionSource === false);
check("host GET no lock mutation", hostFx.mayMutateOwnershipLock === false);
check("host cannot purchase", hostFx.mayPurchase === false);
check("host cannot manage hosts", hostFx.mayManageMediaHosts === false);

console.log("[5] regular member GET causes no writes; no media tools");
const member = evaluateAccess({
  members,
  userId: MEMBER,
  hostUserIds: [HOST],
  subscriptionActive: true,
});
const memberFx = getMediaSideEffects(member);
check("member no tools", member.canUseMediaTools === false);
check("member no open media", member.canOpenMediaScreen === false);
check("member no writes", memberFx.mayMutateOwnershipLock === false && memberFx.mayReconcileSubscriptionSource === false);
check("member no purchase", memberFx.mayPurchase === false);

console.log("[6] non-canonical pastor cannot add/remove media hosts");
check("assistant manage hosts false", assistant.canManageMediaHosts === false);
check("co-pastor role also blocked", (() => {
  const coMembers = [
    { userId: "u_co", churchRole: "Co-Pastor" },
    { userId: CANONICAL, churchRole: "Pastor" },
  ];
  const co = evaluateAccess({ members: coMembers, userId: "u_co", subscriptionActive: true });
  return co.canManageMediaHosts === false && co.isActualChurchPastor === false;
})());

console.log("[7] ownership-lock mutation flag only for canonical pastor");
check("pastor allowMutation true", pastorFx.mayMutateOwnershipLock === true);
check("host allowMutation false", hostFx.mayMutateOwnershipLock === false);
check("member allowMutation false", memberFx.mayMutateOwnershipLock === false);
check("assistant allowMutation false", assistantFx.mayMutateOwnershipLock === false);

console.log("[8] inactive subscription: host cannot use tools");
const hostInactive = evaluateAccess({
  members,
  userId: HOST,
  hostUserIds: [HOST],
  subscriptionActive: false,
});
check("host inactive no tools", hostInactive.canUseMediaTools === false);

console.log("");
console.log(`Canonical pastor authority verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAILURES:", failures.join(", "));
  process.exit(1);
}
console.log("All canonical-pastor authority checks passed.");
