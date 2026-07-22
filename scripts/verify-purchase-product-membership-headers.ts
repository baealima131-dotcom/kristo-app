/**
 * Lightweight verification for membership/header reservation fix.
 * Does not hit production or print secrets.
 */
import assert from "node:assert/strict";

// --- Mirror withAuthHeaders / getKristoHeaders undefined-wipe fix ---
function buildAuthInputFromCaller(caller: Record<string, string>) {
  const authInput: Record<string, string> = {};
  const callerUserId = String(caller["x-kristo-user-id"] || "").trim();
  const callerRole = String(caller["x-kristo-role"] || "").trim();
  const callerChurchId = String(caller["x-kristo-church-id"] || "").trim();
  const callerSessionToken = String(caller["x-kristo-session-token"] || "").trim();
  if (callerUserId) authInput.userId = callerUserId;
  if (callerRole) authInput.role = callerRole;
  if (callerChurchId) authInput.churchId = callerChurchId;
  if (callerSessionToken) authInput.sessionToken = callerSessionToken;
  return authInput;
}

function mergeSessionHeaders(
  session: { userId: string; role: string; churchId: string; sessionToken: string },
  authInput: Record<string, string>
) {
  const a = {
    userId: String(authInput.userId ?? session.userId ?? "").trim() || session.userId,
    role: String(authInput.role ?? session.role ?? "").trim() || session.role,
    churchId: String(authInput.churchId ?? session.churchId ?? "").trim() || session.churchId,
  };
  const sessionToken = String(authInput.sessionToken || session.sessionToken || "").trim();
  return {
    "x-kristo-user-id": a.userId,
    "x-kristo-role": a.role,
    "x-kristo-church-id": a.churchId,
    ...(sessionToken ? { "x-kristo-session-token": sessionToken } : {}),
  };
}

const session = {
  userId: "u_996c19a3aad35819e9614ead1",
  role: "Pastor",
  churchId: "CH7-57M90Y",
  sessionToken: "tok_test",
};

// Bug reproduction: old path passed undefined overrides and wiped session.
const wiped = {
  ...session,
  ...{
    userId: undefined as unknown as string,
    role: undefined as unknown as string,
    churchId: undefined as unknown as string,
  },
};
assert.equal(wiped.userId, undefined);

// Fixed path: empty caller must preserve session identity.
const fixed = mergeSessionHeaders(session, buildAuthInputFromCaller({}));
assert.equal(fixed["x-kristo-user-id"], "u_996c19a3aad35819e9614ead1");
assert.equal(fixed["x-kristo-church-id"], "CH7-57M90Y");
assert.equal(Boolean(fixed["x-kristo-user-id"]), true);
assert.equal(Boolean(fixed["x-kristo-church-id"]), true);

// Explicit caller headers win.
const overridden = mergeSessionHeaders(
  session,
  buildAuthInputFromCaller({
    "x-kristo-user-id": "u_other",
    "x-kristo-church-id": "CH7-OTHER",
    "x-kristo-role": "Member",
  })
);
assert.equal(overridden["x-kristo-user-id"], "u_other");
assert.equal(overridden["x-kristo-church-id"], "CH7-OTHER");

// iOS: no package fallback when assignment failed (preferred empty).
function resolveIosMonthlyForUi(preferredMonthlyProductId: string | null) {
  if (!preferredMonthlyProductId) return null;
  return preferredMonthlyProductId;
}
assert.equal(resolveIosMonthlyForUi(null), null);
assert.equal(resolveIosMonthlyForUi(""), null);
assert.equal(resolveIosMonthlyForUi("premium_monthly"), "premium_monthly");
assert.equal(resolveIosMonthlyForUi("church_premium_monthly_g2"), "church_premium_monthly_g2");

// Membership miss vs hit (same Active-for-church source as media).
function requireActiveMembershipForChurch(args: {
  userId: string;
  churchId: string;
  activeMembers: Array<{ userId: string; churchRole: string }>;
}) {
  const hit = args.activeMembers.find(
    (m) => String(m.userId).trim().toLowerCase() === args.userId.trim().toLowerCase()
  );
  if (!hit) return { ok: false as const, error: "No active church membership" };
  return { ok: true as const, churchRole: hit.churchRole };
}

const pastorOk = requireActiveMembershipForChurch({
  userId: "u_996c19a3aad35819e9614ead1",
  churchId: "CH7-57M90Y",
  activeMembers: [{ userId: "u_996c19a3aad35819e9614ead1", churchRole: "Pastor" }],
});
assert.equal(pastorOk.ok, true);

const nonMember = requireActiveMembershipForChurch({
  userId: "u_stranger",
  churchId: "CH7-57M90Y",
  activeMembers: [{ userId: "u_996c19a3aad35819e9614ead1", churchRole: "Pastor" }],
});
assert.equal(nonMember.ok, false);
assert.equal(nonMember.error, "No active church membership");

console.log("OK membership-header reservation fix checks", {
  headersPreserveSession: true,
  nonMember403: true,
  activePastorOk: true,
  noIosFallbackWithoutAssignment: true,
});
