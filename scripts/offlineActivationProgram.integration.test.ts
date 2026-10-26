/**
 * Offline-activation program (Uvumbuzi Lab + Kristo) end-to-end test on a
 * throw-away filesystem store with fixture accounts only. Nothing is sent to
 * real people: no invitations, notifications, database or network calls.
 *
 * Run: node --test --import ./scripts/_testlib/aliasLoader.mjs \
 *        scripts/offlineActivationProgram.integration.test.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-oact-program-"));
process.chdir(dataRoot);
for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "NEON_DATABASE_URL", "VERCEL"]) {
  delete process.env[key];
}
process.env.KRISTO_SESSION_SECRET = "program-test-session-secret-0123456789";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.UVUMBUZI_BRIDGE_PRIVATE_KEY_PEM_BASE64 = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "pem" }) as string
).toString("base64");
process.env.UVUMBUZI_BRIDGE_ISSUER = "kristo-test";
process.env.UVUMBUZI_BRIDGE_AUDIENCE = "uvumbuzi-lab-test";

// ---------- fixtures (test accounts only) ----------
const U = {
  admin: { id: "u_test_admin", kristoId: "KR7-TADMIN01", name: "Test Admin" },
  sup1: { id: "u_test_sup1", kristoId: "KR7-TSUPER01", name: "Test Supervisor One" },
  sup2: { id: "u_test_sup2", kristoId: "KR7-TSUPER02", name: "Test Supervisor Two" },
  agent1: { id: "u_test_agent1", kristoId: "KR7-TAGENT01", name: "Test Agent One" },
  agent2: { id: "u_test_agent2", kristoId: "KR7-TAGENT02", name: "Test Agent Two" },
  agent3: { id: "u_test_agent3", kristoId: "KR7-TAGENT03", name: "Test Agent Three" },
  leader1: { id: "u_test_leader1", kristoId: "KR7-TLEADR01", name: "Test Pastor One" },
  leader2: { id: "u_test_leader2", kristoId: "KR7-TLEADR02", name: "Test Pastor Two" },
  member: { id: "u_test_member", kristoId: "KR7-TMEMBR01", name: "Test Member" },
};
const C0 = "CH7-TESTHOME";
const C1 = "CH7-TESTONE";
const C2 = "CH7-TESTTWO";

const dataDir = path.join(dataRoot, "data");
fs.mkdirSync(dataDir, { recursive: true });
const writeData = (file: string, value: unknown) =>
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(value, null, 2));
const readData = (file: string) => JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));

writeData(
  "users.json",
  Object.values(U).map((u) => ({ id: u.id, kristoId: u.kristoId, email: `${u.id}@example.test`, password: "x" }))
);
writeData(
  "profiles.json",
  Object.fromEntries(Object.values(U).map((u) => [u.id, { userId: u.id, userCode: u.kristoId, fullName: u.name }]))
);
writeData("churches.json", [
  { id: C0, name: "Test Home Church" },
  { id: C1, name: "Test Church One" },
  { id: C2, name: "Test Church Two" },
]);
const membership = (userId: string, churchId: string, churchRole: string) => ({
  id: `m_${userId}_${churchId}`,
  userId,
  churchId,
  status: "Active",
  churchRole,
  createdAt: "2026-10-01T00:00:00.000Z",
});
writeData("memberships.json", [
  membership(U.sup1.id, C0, "Member"),
  membership(U.sup2.id, C0, "Member"),
  membership(U.agent1.id, C0, "Member"),
  membership(U.agent2.id, C0, "Member"),
  membership(U.agent3.id, C0, "Member"),
  membership(U.leader1.id, C1, "Pastor"),
  membership(U.leader2.id, C2, "Church_Admin"),
  membership(U.member.id, C1, "Member"),
]);
writeData("platform_roles.json", [
  { userId: U.admin.id, platformRole: "System_Admin", updatedAt: "2026-10-01T00:00:00.000Z" },
]);
const membershipsBefore = fs.readFileSync(path.join(dataDir, "memberships.json"), "utf8");

// ---------- helpers ----------
const { NextRequest } = await import("next/server.js");
const { issueSessionToken } = await import("../app/api/auth/_lib/sessionToken.ts");
const program = await import("@/app/api/_lib/offlineActivationProgram");
const { respondToInvitation } = await import("@/app/api/_lib/offlineActivationInvitations");
const { inviteAgentByKristoAndChurch } = await import("@/app/api/_lib/offlineActivationAdmin");
const { deletePlatformRole, upsertPlatformRole, getPlatformRole } = await import("@/app/api/_lib/platformRoles");

const routeCache = new Map<string, any>();
async function routeModule(apiPath: string) {
  if (!routeCache.has(apiPath)) {
    routeCache.set(apiPath, await import(`@/app${apiPath}/route`));
  }
  return routeCache.get(apiPath);
}

type CallOptions = {
  as?: string;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
};

async function call(method: "GET" | "POST", apiPath: string, options: CallOptions = {}) {
  const mod = await routeModule(apiPath);
  const url = new URL(`http://localhost${apiPath}`);
  for (const [k, v] of Object.entries(options.query || {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.headers || {}) };
  if (options.as) headers["x-kristo-session-token"] = issueSessionToken(options.as);
  const req = new NextRequest(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const res = await mod[method](req);
  return { status: res.status as number, body: (await res.json()) as any };
}

function withoutSecrets(value: string) {
  return value;
}

test.after(() => {
  // Leave the temp store for inspection only when asked; it never contains real data.
  if (process.env.KEEP_PROGRAM_TEST_DATA !== "1") fs.rmSync(dataRoot, { recursive: true, force: true });
  else console.log("PROGRAM_TEST_DATA_DIR", dataRoot);
});

// ---------- the flow ----------
const codes: Record<string, { code: string; id: string }> = {};
let onboardingId = "";

test("1. authentication: no credentials, raw headers or mismatched identity are refused", async () => {
  assert.equal((await call("GET", "/api/offline-activation/program/supervisor")).status, 401);
  const raw = await call("GET", "/api/offline-activation/program/admin/overview", {
    headers: { "x-kristo-user-id": U.admin.id, "x-kristo-role": "System_Admin" },
  });
  assert.equal(raw.status, 401, "raw x-kristo-user-id must never be trusted");
  const mismatch = await call("GET", "/api/offline-activation/program/admin/overview", {
    as: U.member.id,
    headers: { "x-kristo-user-id": U.admin.id },
  });
  assert.equal(mismatch.status, 401);
  const forged = await call("GET", "/api/offline-activation/program/admin/overview", {
    headers: { "x-kristo-session-token": `${issueSessionToken(U.admin.id).slice(0, -3)}abc` },
  });
  assert.equal(forged.status, 401);
});

test("2. System Admin invites supervisors with agent limits; others cannot", async () => {
  const denied = await call("POST", "/api/offline-activation/program/admin/supervisors", {
    as: U.member.id,
    body: { kristoId: U.sup1.kristoId, churchId: C0, agentLimit: 2 },
  });
  assert.equal(denied.status, 403);

  const r1 = await call("POST", "/api/offline-activation/program/admin/supervisors", {
    as: U.admin.id,
    body: { kristoId: U.sup1.kristoId, churchId: C0, agentLimit: 2 },
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.outcome, "invited");

  const again = await call("POST", "/api/offline-activation/program/admin/supervisors", {
    as: U.admin.id,
    body: { kristoId: U.sup1.kristoId, churchId: C0 },
  });
  assert.equal(again.body.outcome, "alreadyPending", "repeat invite must not create a second record");

  // Before accepting, the invitee has no supervisor access.
  assert.equal((await call("GET", "/api/offline-activation/program/supervisor", { as: U.sup1.id })).status, 403);
  await respondToInvitation({ invitationId: r1.body.invitation.id, inviteeUserId: U.sup1.id, action: "accept" });

  const r2 = await call("POST", "/api/offline-activation/program/admin/supervisors", {
    as: U.admin.id,
    body: { kristoId: U.sup2.kristoId, churchId: C0, agentLimit: 1 },
  });
  await respondToInvitation({ invitationId: r2.body.invitation.id, inviteeUserId: U.sup2.id, action: "accept" });

  const team = await call("GET", "/api/offline-activation/program/supervisor", { as: U.sup1.id });
  assert.equal(team.status, 200);
  assert.equal(team.body.team.agentLimit, 2);
  assert.equal(team.body.team.agentSlotsUsed, 0);
});

test("3. supervisors cannot raise their own limit, act as admin, or see admin data", async () => {
  for (const [method, p, body] of [
    ["POST", "/api/offline-activation/program/admin/supervisors/limit", { userId: U.sup1.id, agentLimit: 99 }],
    ["POST", "/api/offline-activation/program/admin/members/status", { userId: U.sup2.id, status: "suspended" }],
    ["GET", "/api/offline-activation/program/admin/overview", undefined],
    ["GET", "/api/offline-activation/program/admin/audit", undefined],
    ["POST", "/api/uvumbuzi/admin/login-code", {}],
  ] as const) {
    const res = await call(method, p, { as: U.sup1.id, body });
    assert.equal(res.status, 403, `${method} ${p} must be forbidden for a supervisor`);
  }
  const member = await program.getProgramMember(U.sup1.id);
  assert.equal(member?.agentLimit, 2);
  assert.equal(await getPlatformRole(U.sup1.id), "Supervisor");
});

test("4. invite codes respect the agent limit", async () => {
  const create = (as: string, body: unknown) =>
    call("POST", "/api/offline-activation/program/supervisor/invite-codes", { as, body });

  const a = await create(U.sup1.id, { maxUses: 1, expiresInHours: 1 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.match(a.body.code, /^AG-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  codes.a = { code: a.body.code, id: a.body.invite.id };

  const tooMany = await create(U.sup1.id, { maxUses: 2 });
  assert.equal(tooMany.status, 409, "1 reserved + 2 exceeds a limit of 2");

  const b = await create(U.sup1.id, { maxUses: 1 });
  assert.equal(b.status, 201);
  codes.b = { code: b.body.code, id: b.body.invite.id };

  assert.equal((await create(U.sup1.id, { maxUses: 1 })).status, 409, "limit fully reserved");
  assert.equal((await create(U.agent1.id, { maxUses: 1 })).status, 403, "non-supervisor");
  assert.equal((await create(U.sup1.id, { maxUses: 1, expiresInHours: 10_000 })).status, 400);

  // The plain code is never stored.
  const raw = fs.readFileSync(path.join(dataDir, "offline_activation_program.json"), "utf8");
  assert.ok(!raw.includes(codes.a.code) && !raw.includes(codes.b.code));
});

test("5. agents join with a code; reuse, cross-team and self-redeem are refused", async () => {
  const redeem = (as: string, code: string) =>
    call("POST", "/api/offline-activation/program/agent/redeem", { as, body: { code } });

  assert.equal((await redeem(U.sup1.id, codes.a.code)).status, 400, "own code");
  const ok1 = await redeem(U.agent1.id, codes.a.code.toLowerCase().replace(/-/g, " "));
  assert.equal(ok1.status, 200, JSON.stringify(ok1.body));
  assert.equal(ok1.body.supervisorUserId, U.sup1.id);
  assert.equal(await getPlatformRole(U.agent1.id), "Agent");

  assert.equal((await redeem(U.agent2.id, codes.a.code)).status, 410, "single-use code already used");
  assert.equal((await redeem(U.agent1.id, codes.b.code)).status, 409, "already an agent of this supervisor");
  assert.equal((await redeem(U.agent2.id, "AG-ZZZZ-ZZZZ")).status, 404);

  const ok2 = await redeem(U.agent2.id, codes.b.code);
  assert.equal(ok2.status, 200);

  const team = await call("GET", "/api/offline-activation/program/supervisor", { as: U.sup1.id });
  assert.equal(team.body.team.agentSlotsUsed, 2);
  assert.equal(team.body.team.agents.length, 2);

  // Supervisor 2's code cannot pull supervisor 1's agent into another team.
  const s2code = await call("POST", "/api/offline-activation/program/supervisor/invite-codes", {
    as: U.sup2.id,
    body: { maxUses: 1 },
  });
  assert.equal(s2code.status, 201);
  codes.s2 = { code: s2code.body.code, id: s2code.body.invite.id };
  assert.equal((await redeem(U.agent1.id, codes.s2.code)).status, 409, "already works with another supervisor");
});

test("6. expired and revoked codes cannot be used; other supervisors cannot revoke", async () => {
  await call("POST", "/api/offline-activation/program/admin/supervisors/limit", {
    as: U.admin.id,
    body: { userId: U.sup1.id, agentLimit: 4 },
  });
  const expiring = await call("POST", "/api/offline-activation/program/supervisor/invite-codes", {
    as: U.sup1.id,
    body: { maxUses: 1 },
  });
  const store = readData("offline_activation_program.json");
  const row = store.agentInviteCodes.find((c: any) => c.id === expiring.body.invite.id);
  row.expiresAt = new Date(Date.now() - 60_000).toISOString();
  writeData("offline_activation_program.json", store);
  const expired = await call("POST", "/api/offline-activation/program/agent/redeem", {
    as: U.agent3.id,
    body: { code: expiring.body.code },
  });
  assert.equal(expired.status, 410);
  assert.match(expired.body.error, /expired/);

  const revocable = await call("POST", "/api/offline-activation/program/supervisor/invite-codes", {
    as: U.sup1.id,
    body: { maxUses: 1 },
  });
  const otherTeam = await call("POST", "/api/offline-activation/program/supervisor/invite-codes/revoke", {
    as: U.sup2.id,
    body: { codeId: revocable.body.invite.id },
  });
  assert.equal(otherTeam.status, 404, "another supervisor's code looks missing");
  const revoked = await call("POST", "/api/offline-activation/program/supervisor/invite-codes/revoke", {
    as: U.sup1.id,
    body: { codeId: revocable.body.invite.id },
  });
  assert.equal(revoked.body.invite.state, "revoked");
  const afterRevoke = await call("POST", "/api/offline-activation/program/agent/redeem", {
    as: U.agent3.id,
    body: { code: revocable.body.code },
  });
  assert.equal(afterRevoke.status, 410);
  assert.match(afterRevoke.body.error, /revoked/);
  assert.equal(await getPlatformRole(U.agent3.id), null);

  await call("POST", "/api/offline-activation/program/admin/supervisors/limit", {
    as: U.admin.id,
    body: { userId: U.sup1.id, agentLimit: 2 },
  });
});

test("7. legacy Kristo-ID agent invitations also respect the limit", async () => {
  await assert.rejects(
    () => inviteAgentByKristoAndChurch(U.agent3.kristoId, C0, U.sup1.id),
    /Agent limit reached/
  );
});

test("8. agent registers a church and submits training; duplicates are not created", async () => {
  const onboard = (as: string, body: unknown) =>
    call("POST", "/api/offline-activation/program/agent/onboardings", { as, body });

  assert.equal((await onboard(U.member.id, { leaderKristoId: U.leader1.kristoId })).status, 403, "not an agent");
  assert.equal((await onboard(U.agent1.id, { leaderKristoId: U.agent1.kristoId })).status, 400, "self as leader");

  const invited = await onboard(U.agent1.id, { leaderKristoId: U.leader1.kristoId });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  assert.equal(invited.body.onboarding.status, "invited");
  onboardingId = invited.body.onboarding.id;

  const repeat = await onboard(U.agent1.id, { leaderKristoId: U.leader1.kristoId });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.created, false);
  assert.equal(repeat.body.onboarding.id, onboardingId);

  // Church ID must belong to the leader (pastor/admin), not to an ordinary member.
  assert.equal(
    (await onboard(U.agent2.id, { leaderKristoId: U.member.kristoId, churchId: C1 })).status,
    400
  );
  const registered = await onboard(U.agent1.id, { leaderKristoId: U.leader1.kristoId, churchId: C1 });
  assert.equal(registered.body.onboarding.status, "registered");
  assert.equal(registered.body.onboarding.id, onboardingId);

  // The same church cannot be counted for a second agent.
  const clash = await onboard(U.agent2.id, { leaderKristoId: U.leader1.kristoId, churchId: C1 });
  assert.equal(clash.status, 409);

  const report = (body: Record<string, unknown>) =>
    call("POST", "/api/offline-activation/program/agent/onboardings/report", {
      as: U.agent1.id,
      body: { onboardingId, ...body },
    });

  const pendingTraining = await report({
    trainingTopics: ["Kuingia", "Kanisa"],
    trainingNotes: "Somo la kwanza",
    trainingCompleted: false,
    followUpStatus: "scheduled",
  });
  assert.equal(pendingTraining.status, 200, JSON.stringify(pendingTraining.body));
  assert.equal(pendingTraining.body.onboarding.status, "training_pending");
  assert.equal(pendingTraining.body.confirmationRequested, false);

  const full = {
    trainingTopics: ["Kuingia", "Kanisa", "Live"],
    trainingNotes: "Mafunzo yamekamilika",
    trainingCompleted: true,
    followUpStatus: "completed",
  };
  const done = await report(full);
  assert.equal(done.body.onboarding.status, "awaiting_confirmation");
  assert.equal(done.body.confirmationRequested, true);
  // The agent's own statement is not a confirmation.
  assert.equal(done.body.onboarding.leaderConfirmation.status, "pending");

  const dup = await report(full);
  assert.equal(dup.body.duplicate, true);
  const stored = readData("offline_activation_program.json").onboardings.filter(
    (row: any) => row.churchId === C1
  );
  assert.equal(stored.length, 1, "one record per church");
  assert.equal(stored[0].confirmationHistory.length, 0, "no second confirmation request");

  assert.equal(
    (await call("POST", "/api/offline-activation/program/agent/onboardings/report", {
      as: U.agent2.id,
      body: { onboardingId, ...full },
    })).status,
    404,
    "another agent cannot report on this church"
  );
});

test("9. only the named leader can answer; confirm / needs help / reject", async () => {
  const other = await call("GET", "/api/offline-activation/program/leader/confirmations", { as: U.member.id });
  assert.equal(other.body.requests.length, 0);

  const mine = await call("GET", "/api/offline-activation/program/leader/confirmations", { as: U.leader1.id });
  assert.equal(mine.body.requests.length, 1);
  const request = mine.body.requests[0];
  assert.equal(request.question, "Je, agent huyu amekusaidia na kukufundisha kutumia Kristo? Umeelewa?");
  assert.equal(request.agent.kristoId, U.agent1.kristoId);

  const respond = (as: string, response: string, note?: string) =>
    call("POST", "/api/offline-activation/program/leader/confirmations/respond", {
      as,
      body: { requestId: request.requestId, response, note },
    });

  assert.equal((await respond(U.member.id, "confirm")).status, 404);
  assert.equal((await respond(U.agent1.id, "confirm")).status, 404, "agent cannot confirm own work");
  assert.equal((await respond(U.leader2.id, "confirm")).status, 404, "another church's leader");

  const help = await respond(U.leader1.id, "needs_help", "Bado sijaelewa Live");
  assert.equal(help.body.status, "needs_help");

  // Agent follows up and asks again: a new round, same church record.
  const again = await call("POST", "/api/offline-activation/program/agent/onboardings/report", {
    as: U.agent1.id,
    body: {
      onboardingId,
      trainingTopics: ["Kuingia", "Kanisa", "Live"],
      trainingNotes: "Nimerudia somo la Live",
      trainingCompleted: true,
      followUpStatus: "completed",
    },
  });
  assert.equal(again.body.onboarding.status, "awaiting_confirmation");
  assert.equal(again.body.confirmationRequested, true);

  const second = await call("GET", "/api/offline-activation/program/leader/confirmations", { as: U.leader1.id });
  const secondId = second.body.requests[0].requestId;
  assert.notEqual(secondId, request.requestId);
  const confirm = await call("POST", "/api/offline-activation/program/leader/confirmations/respond", {
    as: U.leader1.id,
    body: { requestId: secondId, response: "confirm" },
  });
  assert.equal(confirm.body.status, "confirmed");
  const twice = await call("POST", "/api/offline-activation/program/leader/confirmations/respond", {
    as: U.leader1.id,
    body: { requestId: secondId, response: "confirm" },
  });
  assert.equal(twice.body.duplicate, true);
  const flip = await call("POST", "/api/offline-activation/program/leader/confirmations/respond", {
    as: U.leader1.id,
    body: { requestId: secondId, response: "reject" },
  });
  assert.equal(flip.status, 409);

  const late = await call("POST", "/api/offline-activation/program/agent/onboardings/report", {
    as: U.agent1.id,
    body: { onboardingId, trainingTopics: ["x"], trainingCompleted: true, followUpStatus: "none" },
  });
  assert.equal(late.status, 409);

  // A second church, rejected by its leader.
  const c2 = await call("POST", "/api/offline-activation/program/agent/onboardings", {
    as: U.agent2.id,
    body: { leaderKristoId: U.leader2.kristoId, churchId: C2 },
  });
  assert.equal(c2.status, 201);
  await call("POST", "/api/offline-activation/program/agent/onboardings/report", {
    as: U.agent2.id,
    body: { onboardingId: c2.body.onboarding.id, trainingTopics: ["Kuingia"], trainingCompleted: true, followUpStatus: "none" },
  });
  const l2 = await call("GET", "/api/offline-activation/program/leader/confirmations", { as: U.leader2.id });
  const rejected = await call("POST", "/api/offline-activation/program/leader/confirmations/respond", {
    as: U.leader2.id,
    body: { requestId: l2.body.requests[0].requestId, response: "reject" },
  });
  assert.equal(rejected.body.status, "rejected");
});

test("10. helping a church gives the agent no church authority", async () => {
  assert.equal(fs.readFileSync(path.join(dataDir, "memberships.json"), "utf8"), membershipsBefore);
  assert.equal(await getPlatformRole(U.agent1.id), "Agent");
});

test("11. progress: admin sees all, supervisor own team, agent own work", async () => {
  const overview = await call("GET", "/api/offline-activation/program/admin/overview", { as: U.admin.id });
  assert.equal(overview.status, 200);
  const totals = overview.body.overview.totals;
  assert.equal(totals.supervisors, 2);
  assert.equal(totals.agents, 2);
  assert.equal(totals.onboardings.byStatus.confirmed, 1);
  assert.equal(totals.onboardings.byStatus.rejected, 1);
  assert.equal(totals.onboardings.churches, 2);
  const s1 = overview.body.overview.supervisors.find((s: any) => s.userId === U.sup1.id);
  assert.equal(s1.agentLimit, 2);
  assert.equal(s1.agents.length, 2);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(overview.body.overview.series.some((d: any) => d.date === today && d.confirmed === 1));

  const future = await call("GET", "/api/offline-activation/program/admin/overview", {
    as: U.admin.id,
    query: { from: "2099-01-01" },
  });
  assert.equal(future.body.overview.totals.onboardings.confirmedInRange, 0);

  const agentDetail = await call("GET", "/api/offline-activation/program/admin/agents", {
    as: U.admin.id,
    query: { userId: U.agent1.id },
  });
  assert.equal(agentDetail.body.churches.length, 1);
  assert.equal(agentDetail.body.churches[0].status, "confirmed");
  assert.equal(agentDetail.body.churches[0].confirmationRounds, 2);

  const supDetail = await call("GET", "/api/offline-activation/program/admin/supervisors", {
    as: U.admin.id,
    query: { userId: U.sup1.id },
  });
  assert.equal(supDetail.body.team.agents.length, 2);

  // Cross-team: supervisor 2 cannot open supervisor 1's agent.
  const cross = await call("GET", "/api/offline-activation/program/supervisor/agents", {
    as: U.sup2.id,
    query: { userId: U.agent1.id },
  });
  assert.equal(cross.status, 404);
  const own = await call("GET", "/api/offline-activation/program/supervisor/agents", {
    as: U.sup1.id,
    query: { userId: U.agent1.id },
  });
  assert.equal(own.status, 200);
  const s2team = await call("GET", "/api/offline-activation/program/supervisor", { as: U.sup2.id });
  assert.equal(s2team.body.team.agents.length, 0);
  assert.equal(s2team.body.team.onboardings.churches, 0);

  const work = await call("GET", "/api/offline-activation/program/agent", { as: U.agent1.id });
  assert.equal(work.body.work.supervisor.userId, U.sup1.id);
  assert.equal(work.body.work.churches.length, 1);
  const work2 = await call("GET", "/api/offline-activation/program/agent", { as: U.agent2.id });
  assert.equal(work2.body.work.churches.length, 1);
  assert.equal(work2.body.work.churches[0].status, "rejected");

  const me = await call("GET", "/api/offline-activation/program/me", { as: U.agent1.id });
  assert.deepEqual(me.body.cards, { supervisor: false, agent: true, leaderConfirmations: 0, canJoinAsAgent: false });
  const meMember = await call("GET", "/api/offline-activation/program/me", { as: U.member.id });
  assert.deepEqual(meMember.body.cards, { supervisor: false, agent: false, leaderConfirmations: 0, canJoinAsAgent: true });
});

test("12. suspend and revoke keep history and close access", async () => {
  const setStatus = (userId: string, status: string, as = U.admin.id) =>
    call("POST", "/api/offline-activation/program/admin/members/status", {
      as,
      body: { userId, status, reason: "test" },
    });

  assert.equal((await setStatus(U.sup1.id, "suspended")).status, 200);
  assert.equal((await call("GET", "/api/offline-activation/program/supervisor", { as: U.sup1.id })).status, 403);
  assert.equal(
    (await call("GET", "/api/offline-activation/program/agent", { as: U.agent1.id })).status,
    403,
    "agents of a suspended supervisor are paused"
  );
  const me = await call("GET", "/api/offline-activation/program/me", { as: U.sup1.id });
  assert.equal(me.body.cards.supervisor, false);
  await assert.rejects(
    () => program.assertProgramMemberAllowed(U.sup1.id, "Supervisor", { requireAgentRegistration: false }),
    /suspended/,
    "legacy offline-activation routes see the suspension too"
  );

  assert.equal((await setStatus(U.sup1.id, "active")).status, 200);
  assert.equal((await call("GET", "/api/offline-activation/program/agent", { as: U.agent1.id })).status, 200);

  assert.equal((await setStatus(U.agent2.id, "revoked")).status, 200);
  assert.equal(await getPlatformRole(U.agent2.id), null);
  assert.equal((await call("GET", "/api/offline-activation/program/agent", { as: U.agent2.id })).status, 403);
  const team = await call("GET", "/api/offline-activation/program/supervisor", { as: U.sup1.id });
  assert.equal(team.body.team.agentSlotsUsed, 1, "a revoked agent frees the slot");
  const history = readData("offline_activation_program.json").onboardings.filter(
    (row: any) => row.agentUserId === U.agent2.id
  );
  assert.equal(history.length, 1, "revoking keeps the agent's church records");

  assert.equal((await setStatus(U.admin.id, "suspended")).status, 400, "cannot change own access");
});

test("13. audit history records every step without secrets", async () => {
  const res = await call("GET", "/api/offline-activation/program/admin/audit", {
    as: U.admin.id,
    query: { limit: "500" },
  });
  const actions = new Set(res.body.events.map((e: any) => e.action));
  for (const action of [
    "supervisor.invited",
    "supervisor.invitation_responded",
    "role.granted",
    "role.removed",
    "supervisor.limit_changed",
    "invite_code.created",
    "invite_code.revoked",
    "agent.code_redeemed",
    "onboarding.created",
    "onboarding.church_registered",
    "onboarding.report_submitted",
    "confirmation.requested",
    "confirmation.responded",
    "member.status_changed",
  ]) {
    assert.ok(actions.has(action), `missing audit action ${action}`);
  }
  const raw = withoutSecrets(fs.readFileSync(path.join(dataDir, "offline_activation_audit.json"), "utf8"));
  for (const { code } of Object.values(codes)) assert.ok(!raw.includes(code), "audit must not contain codes");
  assert.ok(!raw.includes(process.env.KRISTO_SESSION_SECRET!));
});

test("14. UVUMBUZI Lab admin pass: one-time code, scoped token, role re-checked", async () => {
  const issued = await call("POST", "/api/uvumbuzi/admin/login-code", { as: U.admin.id });
  assert.equal(issued.status, 201);
  const exchange = (code: string) => call("POST", "/api/uvumbuzi/admin/session", { body: { code } });

  const session = await exchange(issued.body.code);
  assert.equal(session.status, 200, JSON.stringify(session.body));
  assert.equal(session.body.subject, U.admin.id);
  assert.equal((await exchange(issued.body.code)).status, 401, "single use");
  assert.equal((await exchange("ABCD-EFGH")).status, 401);

  const bearer = { authorization: `Bearer ${session.body.token}` };
  const overview = await call("GET", "/api/offline-activation/program/admin/overview", { headers: bearer });
  assert.equal(overview.status, 200);

  // The pass is useless outside System Admin routes, and cannot mint codes.
  assert.equal((await call("GET", "/api/offline-activation/program/supervisor", { headers: bearer })).status, 401);
  assert.equal((await call("POST", "/api/uvumbuzi/admin/login-code", { headers: bearer })).status, 401);

  const tampered = session.body.token.replace(/\.[^.]+$/, ".AAAA");
  assert.equal(
    (await call("GET", "/api/offline-activation/program/admin/overview", {
      headers: { authorization: `Bearer ${tampered}` },
    })).status,
    401
  );

  // Removing the System_Admin role ends access even with a still-valid pass.
  await deletePlatformRole(U.admin.id);
  assert.equal((await call("GET", "/api/offline-activation/program/admin/overview", { headers: bearer })).status, 403);
  await upsertPlatformRole(U.admin.id, "System_Admin", "restored by test");

  // A code issued to an admin who loses the role cannot be exchanged.
  const issued2 = await call("POST", "/api/uvumbuzi/admin/login-code", { as: U.admin.id });
  await deletePlatformRole(U.admin.id);
  assert.equal((await exchange(issued2.body.code)).status, 403);
  await upsertPlatformRole(U.admin.id, "System_Admin", "restored by test");
});
