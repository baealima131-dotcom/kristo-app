/**
 * Offline-activation program on REAL Postgres: tables + constraints + one
 * PL/pgSQL transaction per write. Concurrent requests come from separate
 * processes (each one = a server instance), through the app's own
 * @neondatabase/serverless code path and a local Neon-HTTP adapter.
 *
 * Also: a transaction that holds its locks for >20 s, a process killed (SIGKILL)
 * half-way through a write, and the one-time import of existing JSON data.
 *
 * Needs a throw-away database (it is wiped):
 *   KRISTO_TEST_POSTGRES_URL=postgresql://kristo_test@127.0.0.1:55432/kristo_concurrency_test \
 *   KRISTO_REVIEW_TOOLS_DIR=.review-tools \
 *   node --test --import ./scripts/_testlib/aliasLoader.mjs scripts/offlineActivationProgram.postgres.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pgUrl = String(process.env.KRISTO_TEST_POSTGRES_URL || "");
const toolsDir = path.resolve(repoRoot, process.env.KRISTO_REVIEW_TOOLS_DIR || ".review-tools");
const skip =
  !pgUrl ? "KRISTO_TEST_POSTGRES_URL not set" :
  !/@(127\.0\.0\.1|localhost):\d+\/[\w-]*test[\w-]*$/.test(pgUrl) ? "refusing: URL must be a local *test* database" :
  !fs.existsSync(path.join(toolsDir, "neonHttpProxy.mjs")) ? "review tools missing" : false;

const hash = (code: string) =>
  crypto.createHash("sha256").update(`kristo-oact-program:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`).digest("hex");

test("offline-activation program on Postgres: transactions, constraints, long locks, crashes, migration", { skip, timeout: 240_000 }, async (t) => {
  const { startNeonHttpProxy } = await import(pathToFileURL(path.join(toolsDir, "neonHttpProxy.mjs")).href);
  const proxy = await startNeonHttpProxy({ connectionString: pgUrl, maxConnections: 40 });
  const pool = proxy.pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

  // Fresh database with data that existed BEFORE the tables: legacy store table
  // (no version column), legacy agents, and today's JSON-era program + audit docs.
  await q("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await q(`CREATE TABLE kristo_offline_activation_store (
    key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const legacyAgents = Array.from({ length: 7 }, (_, i) => ({
    id: `oactagent_legacy_${i}`, supervisorUserId: "u_pg_oldsup", kristoId: `KR7-PGOLD00${i}`, churchId: "CH7-PGHOME",
    fullName: `Legacy Agent ${i}`, phone: "", status: "accepted", linkedUserId: `u_pg_legacy_${i}`,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  }));
  const legacyCodes = { batches: [{ batchId: "legacy-batch", codes: [{ code: "LEGACY-0001", status: "available" }] }] };
  const jsonProgram = {
    version: 1,
    members: { u_pg_oldsup: { userId: "u_pg_oldsup", role: "Supervisor", status: "active", createdAt: "2026-10-26T08:00:00.000Z", updatedAt: "2026-10-26T08:00:00.000Z" } },
    agentInviteCodes: [{ id: "oactcode_json_1", codeHash: "json-era-hash", codePreview: "ABCD", supervisorUserId: "u_pg_oldsup",
      maxUses: 1, uses: [], expiresAt: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-26T08:00:00.000Z", createdBy: "u_pg_oldsup",
      revokedAt: "2026-10-26T09:00:00.000Z", revokedBy: "u_pg_oldsup" }],
    onboardings: [{ id: "oactonb_json_1", agentUserId: "u_pg_legacy_0", supervisorUserId: "u_pg_oldsup", leaderUserId: "u_pg_json_leader",
      leaderKristoId: "KR7-PGJSONLD", churchId: "CH7-PGJSON", registeredAt: "2026-10-26T08:10:00.000Z", status: "confirmed",
      agentReport: { trainingTopics: ["Kuingia"], trainingNotes: "", trainingCompleted: true, followUpStatus: "completed", followUpNote: "", submittedAt: "2026-10-26T08:20:00.000Z", version: 1 },
      leaderConfirmation: { requestId: "oactconf_json_1", status: "confirmed", question: "Q", requestedAt: "2026-10-26T08:20:00.000Z", reportVersion: 1,
        respondedAt: "2026-10-26T08:30:00.000Z", respondedByUserId: "u_pg_json_leader" },
      confirmationHistory: [], createdAt: "2026-10-26T08:10:00.000Z", updatedAt: "2026-10-26T08:30:00.000Z" }],
    adminLoginCodes: [],
  };
  const jsonAudit = { events: [{ id: "oaudit_json_1", at: "2026-10-26T08:30:00.000Z", actorUserId: "u_pg_json_leader", actorRole: "Church_Leader",
    action: "confirmation.responded", targetType: "confirmation", targetId: "oactconf_json_1", details: { response: "confirmed" } }] };
  await q("INSERT INTO kristo_offline_activation_store (key, data) VALUES ($1,$2),($3,$4),($5,$6),($7,$8)", [
    "offline_activation_agents.json", JSON.stringify({ agents: legacyAgents }),
    "offline_activation_codes.json", JSON.stringify(legacyCodes),
    "offline_activation_program.json", JSON.stringify(jsonProgram),
    "offline_activation_audit.json", JSON.stringify(jsonAudit),
  ]);
  const jsonDocsBefore = await q("SELECT key, data FROM kristo_offline_activation_store ORDER BY key");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-oact-pg-"));
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://kristo_test:unused@localhost/kristo_concurrency_test",
    KRISTO_REVIEW_LOCAL_NEON_HTTP_ENDPOINT: proxy.endpoint,
    KRISTO_SESSION_SECRET: "pg-test-session-secret-0123456789abcdef",
  } as Record<string, string>;
  delete env.VERCEL;
  Object.assign(process.env, env);
  process.chdir(work);
  t.after(async () => {
    await proxy.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  const program = await import("@/app/api/_lib/offlineActivationProgram");
  const { updateOfflineActivationJsonFile } = await import("@/app/api/_lib/store/offlineActivationDb");
  const { ensureProgramSchema } = await import("@/app/api/_lib/store/offlineActivationProgramDb");
  const { seedChurches, seedUsers } = await import("./_testlib/programFixtures.ts");
  const { respondToInvitation } = await import("@/app/api/_lib/offlineActivationInvitations");

  const runWorkers = async (jobs: Record<string, unknown>[], startDelay = 1500) => {
    const startAt = Date.now() + startDelay;
    return Promise.all(
      jobs.map(
        (job, i) =>
          new Promise<any>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              ["--no-warnings", "--import", path.join(repoRoot, "scripts/_testlib/aliasLoader.mjs"),
                path.join(repoRoot, "scripts/_testlib/programWorker.ts"), JSON.stringify({ ...job, id: i, startAt })],
              { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] }
            );
            let out = "";
            child.stdout.on("data", (d) => (out += d));
            child.on("error", reject);
            child.on("close", () => {
              const line = out.split("\n").find((l) => l.startsWith("RESULT "));
              resolve({ ...(line ? JSON.parse(line.slice(7)) : { ok: false, error: "no result" }), finishedAt: Date.now() });
            });
          })
      )
    );
  };
  const holdTransaction = (sql: string, params: unknown[], sleepSeconds: number) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts/_testlib/pgHoldWorker.mjs"), toolsDir, pgUrl,
      String(sleepSeconds), sql, JSON.stringify(params)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const locked = new Promise<string>((resolve) => child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("LOCKED") || out.includes("ERROR")) resolve(out);
    }));
    const closed = new Promise<string>((resolve) => child.on("close", () => resolve(out)));
    return { child, locked, closed };
  };

  // 0. Schema + one-time import (also concurrently from 6 cold-starting instances).
  const coldStart = await runWorkers(Array.from({ length: 6 }, () => ({ action: "initProgramSchema" })));
  assert.ok(coldStart.every((r) => r.ok), JSON.stringify(coldStart));
  await ensureProgramSchema();
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_migrations"))[0].n, 1, "import ran exactly once");
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_onboardings WHERE id = 'oactonb_json_1'"))[0].n, 1);
  assert.equal((await q("SELECT status FROM kristo_oact_confirmations WHERE request_id = 'oactconf_json_1'"))[0].status, "confirmed");
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_audit WHERE id = 'oaudit_json_1'"))[0].n, 1);
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_invite_codes WHERE id = 'oactcode_json_1' AND revoked_at IS NOT NULL"))[0].n, 1);
  for (const row of await q("SELECT key, data FROM kristo_offline_activation_store WHERE key <> 'offline_activation_agents.json' ORDER BY key")) {
    const before = jsonDocsBefore.find((b: any) => b.key === row.key);
    assert.deepEqual(row.data, before.data, `${row.key} kept as backup, unchanged`);
  }

  const HOME = "CH7-PGHOME";
  await seedChurches([{ id: HOME, name: "PG Home" }, { id: "CH7-PGONE", name: "PG One" }]);
  const members = Array.from({ length: 14 }, (_, i) => ({
    id: `u_pg_m${i}`, kristoId: `KR7-PGMEM${String(i).padStart(3, "0")}`, name: `PG Member ${i}`,
    email: `pg-m${i}@example.test`, church: { id: HOME, role: "Member" as const },
  }));
  await seedUsers([
    { id: "u_pg_admin", kristoId: "KR7-PGADMIN1", name: "PG Admin", email: "pg-admin@example.test", platformRole: "System_Admin" },
    { id: "u_pg_sup", kristoId: "KR7-PGSUPER1", name: "PG Supervisor", email: "pg-sup@example.test", church: { id: HOME, role: "Member" } },
    { id: "u_pg_oldsup", kristoId: "KR7-PGOLDSUP", name: "Old Supervisor", email: "pg-old@example.test", church: { id: HOME, role: "Member" }, platformRole: "Supervisor" },
    { id: "u_pg_leader", kristoId: "KR7-PGLEADR1", name: "PG Pastor", email: "pg-leader@example.test", church: { id: "CH7-PGONE", role: "Pastor" } },
    ...members,
  ]);

  // 1. Compare-and-swap still protects the remaining JSON documents: 40 concurrent appends kept.
  await Promise.all(Array.from({ length: 40 }, (_, i) =>
    updateOfflineActivationJsonFile<{ batches: unknown[] }>("offline_activation_codes.json",
      (cur) => ({ batches: [...(cur?.batches || []), { batchId: `cas-${i}`, codes: [] }] }), { batches: [] })));
  const casDoc = (await q("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_codes.json'"))[0].data;
  assert.equal(casDoc.batches.filter((b: any) => String(b.batchId).startsWith("cas-")).length, 40);
  assert.ok(casDoc.batches.some((b: any) => b.batchId === "legacy-batch"), "legacy batch kept");

  // 2. Limits: legacy supervisor with 7 agents keeps 7, cannot be lowered below it; a new one starts at 5.
  assert.equal((await program.supervisorTeamView("u_pg_oldsup")).agentLimit, 7);
  await assert.rejects(() => program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_oldsup", agentLimit: 6 }), /cannot be lower/);
  await assert.rejects(() => program.createAgentInviteCode({ supervisorUserId: "u_pg_oldsup", maxUses: 1 }), /Agent limit reached/);
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_oldsup", agentLimit: 9 });
  const oldTeam = await program.supervisorTeamView("u_pg_oldsup");
  assert.equal(oldTeam.agentLimit, 9);
  assert.equal(oldTeam.agents.length, 7);

  const invited = await program.adminInviteSupervisor({ actorUserId: "u_pg_admin", kristoId: "KR7-PGSUPER1", churchId: HOME });
  assert.equal(invited.outcome, "invited");
  assert.equal((await program.adminInviteSupervisor({ actorUserId: "u_pg_admin", kristoId: "KR7-PGSUPER1", churchId: HOME })).outcome, "alreadyPending");
  await respondToInvitation({ invitationId: invited.invitation!.id, inviteeUserId: "u_pg_sup", action: "accept" });
  assert.equal((await program.supervisorTeamView("u_pg_sup")).agentLimit, 5);
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_sup", agentLimit: 3 });

  // 3. Limit under concurrency: 8 instances create codes; limit 3 -> exactly 3.
  const created = await runWorkers(Array.from({ length: 8 }, () => ({ action: "createCode", supervisorUserId: "u_pg_sup" })));
  assert.equal(created.filter((r) => r.ok).length, 3, JSON.stringify(created));
  assert.ok(created.filter((r) => !r.ok).every((r) => /Agent limit reached/.test(r.error)), JSON.stringify(created));

  // 4. A transaction that holds the supervisor lock for 25 s (longer than the old 20 s lease):
  //    competing instances wait for it; nothing slips through; the limit holds.
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_sup", agentLimit: 5 });
  const longTx = holdTransaction(
    "SELECT oact_create_invite_code($1, $2, $3, 'LONG', 1, NOW() + interval '1 hour', 5) AS r",
    ["u_pg_sup", "oactcode_long_tx", hash("AG-LONG-HOLD")], 25);
  assert.match(await longTx.locked, /LOCKED/);
  const waitStarted = Date.now();
  const whileLocked = await runWorkers(Array.from({ length: 3 }, () => ({ action: "createCode", supervisorUserId: "u_pg_sup" })), 200);
  assert.match(await longTx.closed, /COMMITTED/);
  assert.ok(whileLocked.every((r) => r.finishedAt - waitStarted > 20_000), "competitors waited for the long transaction");
  // 3 earlier codes + the long one = 4 of 5 -> exactly one competitor fits.
  assert.equal(whileLocked.filter((r) => r.ok).length, 1, JSON.stringify(whileLocked));
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_invite_codes WHERE supervisor_user_id = 'u_pg_sup'"))[0].n, 5);

  // 5. A process killed half-way through a redemption: everything rolls back and the code stays usable.
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_sup", agentLimit: 9 });
  const crashCode = await program.createAgentInviteCode({ supervisorUserId: "u_pg_sup", maxUses: 1 });
  const agentsBefore = (await q("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_agents.json'"))[0].data;
  const crash = holdTransaction(
    "SELECT oact_redeem_invite_code($1, $2, $3, $4::jsonb, 5, $5) AS r",
    [members[0].id, hash(crashCode.code), HOME, JSON.stringify({ id: "oactagent_crash", kristoId: members[0].kristoId, churchId: HOME,
      fullName: "Crash", phone: "", status: "accepted", linkedUserId: members[0].id, createdAt: "x", updatedAt: "x" }), "x"], 60);
  assert.match(await crash.locked, /LOCKED/);
  crash.child.kill("SIGKILL");
  await crash.closed;
  const afterCrash = await runWorkers([{ action: "redeem", userId: members[1].id, code: crashCode.code }], 100);
  assert.equal(afterCrash[0].ok, true, JSON.stringify(afterCrash));
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_invite_code_uses WHERE user_id = $1", [members[0].id]))[0].n, 0);
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_platform_roles WHERE user_id = $1", [members[0].id]))[0].n, 0);
  const agentsAfter = (await q("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_agents.json'"))[0].data;
  assert.ok(!agentsAfter.agents.some((a: any) => a.id === "oactagent_crash"), "no half-written registration");
  assert.equal(agentsAfter.agents.length, agentsBefore.agents.length + 1, "only the successful redemption was added");

  // 6. Code use under concurrency: single-use code, 6 members at once -> exactly one agent.
  const single = await program.createAgentInviteCode({ supervisorUserId: "u_pg_sup", maxUses: 1 });
  const redeemers = members.slice(2, 8);
  const redeemed = await runWorkers(redeemers.map((m) => ({ action: "redeem", userId: m.id, code: single.code })));
  assert.equal(redeemed.filter((r) => r.ok).length, 1, JSON.stringify(redeemed));
  assert.ok(redeemed.filter((r) => !r.ok).every((r) => r.status === 410), JSON.stringify(redeemed));
  assert.equal((await q("SELECT used_count FROM kristo_oact_invite_codes WHERE id = $1", [single.invite.id]))[0].used_count, 1);

  // 7. Legacy Kristo-ID invitations racing with open code slots stay within the limit.
  const before7 = await program.supervisorTeamView("u_pg_sup");
  const open7 = before7.inviteCodes.filter((c) => c.state === "active").reduce((s, c) => s + c.maxUses - c.usedCount, 0);
  const room = before7.agentLimit - before7.agentSlotsUsed - open7;
  const mixed = await runWorkers(members.slice(8, 14).map((m) => ({ action: "legacyInvite", kristoId: m.kristoId, churchId: HOME, supervisorUserId: "u_pg_sup" })));
  assert.equal(mixed.filter((r) => r.ok).length, Math.max(0, Math.min(6, room)), JSON.stringify({ room, mixed }));
  assert.ok(mixed.filter((r) => !r.ok).every((r) => /Agent limit reached/.test(r.error)), JSON.stringify(mixed));

  // 8. Duplicate church registration: same agent x3 + another agent x3 at once -> one record.
  const agentA = members[1].id;
  const agentB = redeemers[redeemed.find((r) => r.ok)!.id].id;
  const jobs = [
    ...Array.from({ length: 3 }, () => ({ action: "onboard", agentUserId: agentA, supervisorUserId: "u_pg_sup", leaderKristoId: "KR7-PGLEADR1", churchId: "CH7-PGONE" })),
    ...Array.from({ length: 3 }, () => ({ action: "onboard", agentUserId: agentB, supervisorUserId: "u_pg_sup", leaderKristoId: "KR7-PGLEADR1", churchId: "CH7-PGONE" })),
  ];
  const onboarded = await runWorkers(jobs);
  const rows = await q("SELECT * FROM kristo_oact_onboardings WHERE church_id = 'CH7-PGONE'");
  assert.equal(rows.length, 1, "one record per church (unique index)");
  assert.equal(onboarded.filter((r) => r.ok && r.created === true).length, 1, JSON.stringify(onboarded));
  for (const r of onboarded) {
    if ((jobs[r.id] as any).agentUserId === rows[0].agent_user_id) assert.ok(r.ok, JSON.stringify(r));
    else assert.equal(r.status, 409, JSON.stringify(r));
  }

  // 9. Training submitted 4x at once -> one pending request; conflicting leader answers -> one recorded.
  const owner = rows[0].agent_user_id;
  await Promise.all(Array.from({ length: 4 }, () =>
    program.submitTrainingReport({ agentUserId: owner, onboardingId: rows[0].id, trainingTopics: ["Kuingia"], trainingCompleted: true, followUpStatus: "completed" })
      .catch((e: any) => e)));
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_oact_confirmations WHERE onboarding_id = $1 AND status = 'pending'", [rows[0].id]))[0].n, 1);
  const [request] = await program.listLeaderConfirmations("u_pg_leader");
  const answers = ["confirm", "reject", "confirm", "needs_help"];
  const responded = await runWorkers(answers.map((response) => ({ action: "respond", leaderUserId: "u_pg_leader", requestId: request.requestId, response })));
  const final = (await q("SELECT status FROM kristo_oact_confirmations WHERE request_id = $1", [request.requestId]))[0].status;
  for (const r of responded) {
    const same = ({ confirm: "confirmed", reject: "rejected", needs_help: "needs_help" } as any)[answers[r.id]] === final;
    assert.ok(same ? r.ok : r.status === 409, JSON.stringify(responded));
  }
  assert.equal((await q("SELECT status FROM kristo_oact_onboardings WHERE id = $1", [rows[0].id]))[0].status, final);

  // 10. Constraints reject bad data even from direct SQL (defence in depth).
  await assert.rejects(() => q("UPDATE kristo_oact_invite_codes SET used_count = max_uses + 1 WHERE id = $1", [single.invite.id]));
  await assert.rejects(() => q(`INSERT INTO kristo_oact_onboardings (id, agent_user_id, supervisor_user_id, leader_user_id,
    leader_kristo_id, church_id, registered_at, status) VALUES ('dup', 'x', 'y', 'z', 'K', 'CH7-PGONE', NOW(), 'registered')`));
  await q(`INSERT INTO kristo_oact_confirmations (request_id, onboarding_id, leader_user_id, status, question, report_version, requested_at)
    VALUES ('p2', $1, 'u_pg_leader', 'pending', 'q', 9, NOW())`, [rows[0].id]);
  await assert.rejects(() => q(`INSERT INTO kristo_oact_confirmations (request_id, onboarding_id, leader_user_id, status, question, report_version, requested_at)
    VALUES ('p3', $1, 'u_pg_leader', 'pending', 'q', 9, NOW())`, [rows[0].id]), /one_pending/);
  await q("DELETE FROM kristo_oact_confirmations WHERE request_id = 'p2'");
  await assert.rejects(() => q("INSERT INTO kristo_oact_invite_code_uses (code_id, user_id) VALUES ($1, $2)", [single.invite.id, members[1].id])
    .then(() => q("INSERT INTO kristo_oact_invite_code_uses (code_id, user_id) VALUES ($1, $2)", [single.invite.id, members[1].id])));

  // 11. Suspend / revoke are transactional and keep history.
  await program.adminSetMemberStatus({ actorUserId: "u_pg_admin", userId: agentA, status: "revoked", reason: "test" });
  assert.equal((await q("SELECT count(*)::int AS n FROM kristo_platform_roles WHERE user_id = $1", [agentA]))[0].n, 0);
  assert.equal((await q("SELECT status FROM kristo_oact_members WHERE user_id = $1", [agentA]))[0].status, "revoked");
  const actions = (await q("SELECT action FROM kristo_oact_audit WHERE target_id = $1", [agentA])).map((r: any) => r.action);
  assert.ok(actions.includes("role.removed") && actions.includes("member.status_changed"));

  // 12. Legacy data intact.
  const agentsFinal = (await q("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_agents.json'"))[0].data.agents;
  for (const legacy of legacyAgents) assert.ok(agentsFinal.some((a: any) => a.id === legacy.id && a.status === "accepted"));
  console.log("PG_PROXY_STATS", JSON.stringify(proxy.stats));
});
