/**
 * Offline-activation program on REAL Postgres, with concurrent requests from
 * separate processes (each process = one server instance). Uses the app's own
 * @neondatabase/serverless code path through a local Neon-HTTP adapter.
 *
 * Needs a throw-away database (it is wiped):
 *   KRISTO_TEST_POSTGRES_URL=postgresql://kristo_test@127.0.0.1:55432/kristo_concurrency_test \
 *   KRISTO_REVIEW_TOOLS_DIR=.review-tools \
 *   node --test --import ./scripts/_testlib/aliasLoader.mjs scripts/offlineActivationProgram.postgres.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

test("offline-activation program on Postgres: concurrency, limits, codes, duplicates, data preserved", { skip }, async (t) => {
  const { startNeonHttpProxy } = await import(pathToFileURL(path.join(toolsDir, "neonHttpProxy.mjs")).href);
  const proxy = await startNeonHttpProxy({ connectionString: pgUrl, maxConnections: 40 });
  const pool = proxy.pool;

  // Fresh database, then a PRE-EXISTING legacy table (no version column) with data.
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.query(`CREATE TABLE kristo_offline_activation_store (
    key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const legacyAgents = Array.from({ length: 7 }, (_, i) => ({
    id: `oactagent_legacy_${i}`, supervisorUserId: "u_pg_oldsup", kristoId: `KR7-PGOLD00${i}`, churchId: "CH7-PGHOME",
    fullName: `Legacy Agent ${i}`, phone: "", status: "accepted", linkedUserId: `u_pg_legacy_${i}`,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  }));
  const legacyCodes = { batches: [{ batchId: "legacy-batch", codes: [{ code: "LEGACY-0001", status: "available" }] }] };
  await pool.query("INSERT INTO kristo_offline_activation_store (key, data) VALUES ($1, $2), ($3, $4)", [
    "offline_activation_agents.json", JSON.stringify({ agents: legacyAgents }),
    "offline_activation_codes.json", JSON.stringify(legacyCodes),
  ]);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-oact-pg-"));
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://kristo_test:unused@localhost/kristo_concurrency_test",
    KRISTO_REVIEW_LOCAL_NEON_HTTP_ENDPOINT: proxy.endpoint,
    KRISTO_SESSION_SECRET: "pg-test-session-secret-0123456789abcdef",
  };
  delete (env as any).VERCEL;
  Object.assign(process.env, env);
  process.chdir(work);
  t.after(async () => {
    await proxy.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  const program = await import("@/app/api/_lib/offlineActivationProgram");
  const { appendOfflineActivationAudit, listOfflineActivationAudit } = await import("@/app/api/_lib/offlineActivationAudit");
  const { seedChurches, seedUsers } = await import("./_testlib/programFixtures.ts");
  const { respondToInvitation } = await import("@/app/api/_lib/offlineActivationInvitations");

  const HOME = "CH7-PGHOME";
  await seedChurches([
    { id: HOME, name: "PG Home" },
    { id: "CH7-PGONE", name: "PG One" },
  ]);
  const members = Array.from({ length: 12 }, (_, i) => ({
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

  // Workers = separate processes that share only the database.
  const runWorkers = async (jobs: Record<string, unknown>[]) => {
    const startAt = Date.now() + 1500;
    const results = await Promise.all(
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
              resolve(line ? JSON.parse(line.slice(7)) : { ok: false, error: "no result", out: out.slice(-500) });
            });
          })
      )
    );
    return results;
  };

  // 0. Schema upgrade (runs on first use) kept legacy data.
  const { ensureOfflineActivationStoreReady } = await import("@/app/api/_lib/store/offlineActivationDb");
  await ensureOfflineActivationStoreReady();
  const legacyRows = await pool.query("SELECT key, data, version FROM kristo_offline_activation_store ORDER BY key");
  const agentsRow = legacyRows.rows.find((r: any) => r.key === "offline_activation_agents.json");
  assert.equal(agentsRow.data.agents.length, 7);
  assert.equal(Number(agentsRow.version), 0, "existing rows got version 0");

  // 1. Lost updates: 40 concurrent appends from one process → all 40 kept.
  await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      appendOfflineActivationAudit({ actorUserId: "u_pg_admin", actorRole: "System_Admin", action: "role.granted", targetType: "user", targetId: `cas-${i}` })
    )
  );
  const casEvents = (await listOfflineActivationAudit({ limit: 1000 })).filter((e) => e.targetId.startsWith("cas-"));
  assert.equal(casEvents.length, 40, "compare-and-swap kept every concurrent append");

  // 2. Legacy supervisor with 7 agents: effective limit 7, never lowered below that, nobody removed.
  const oldTeam = await program.supervisorTeamView("u_pg_oldsup");
  assert.equal(oldTeam.agentLimit, 7);
  assert.equal(oldTeam.agentSlotsUsed, 7);
  await assert.rejects(
    () => program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_oldsup", agentLimit: 6 }),
    /cannot be lower/
  );
  await assert.rejects(() => program.createAgentInviteCode({ supervisorUserId: "u_pg_oldsup", maxUses: 1 }), /Agent limit reached/);
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_oldsup", agentLimit: 9 });
  assert.equal((await program.supervisorTeamView("u_pg_oldsup")).agentLimit, 9);
  assert.equal((await program.supervisorTeamView("u_pg_oldsup")).agents.length, 7);

  // New supervisor: default limit 5, admin lowers it to 3.
  const invited = await program.adminInviteSupervisor({ actorUserId: "u_pg_admin", kristoId: "KR7-PGSUPER1", churchId: HOME });
  await respondToInvitation({ invitationId: invited.invitation!.id, inviteeUserId: "u_pg_sup", action: "accept" });
  assert.equal((await program.supervisorTeamView("u_pg_sup")).agentLimit, 5);
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_sup", agentLimit: 3 });

  // 3. Agent limit under concurrency: 8 instances create codes at once; limit 3 → exactly 3.
  const created = await runWorkers(Array.from({ length: 8 }, () => ({ action: "createCode", supervisorUserId: "u_pg_sup" })));
  assert.equal(created.filter((r) => r.ok).length, 3, JSON.stringify(created));
  assert.ok(created.filter((r) => !r.ok).every((r) => /Agent limit reached/.test(r.error)), JSON.stringify(created));

  // 4. Code use under concurrency: one single-use code, 6 members redeem at once → exactly one agent.
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_sup", agentLimit: 6 });
  const single = await program.createAgentInviteCode({ supervisorUserId: "u_pg_sup", maxUses: 1 });
  const redeemed = await runWorkers(members.slice(0, 6).map((m) => ({ action: "redeem", userId: m.id, code: single.code })));
  assert.equal(redeemed.filter((r) => r.ok).length, 1, JSON.stringify(redeemed));
  const codeRow = (await pool.query("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_program.json'")).rows[0].data
    .agentInviteCodes.find((c: any) => c.id === single.invite.id);
  assert.equal(codeRow.uses.length, 1);

  // 5. Limit across code redemptions + legacy invitations at once: limit 6, already 1 agent + 3 open code slots.
  const team = await program.supervisorTeamView("u_pg_sup");
  const openCodes = team.inviteCodes.filter((c) => c.state === "active").length;
  assert.equal(team.agentSlotsUsed + openCodes, 4);
  const mixed = await runWorkers(
    members.slice(6, 12).map((m) => ({ action: "legacyInvite", kristoId: m.kristoId, churchId: HOME, supervisorUserId: "u_pg_sup" }))
  );
  assert.equal(mixed.filter((r) => r.ok).length, 2, JSON.stringify(mixed));
  const after = await program.supervisorTeamView("u_pg_sup");
  assert.ok(after.agentSlotsUsed + after.inviteCodes.filter((c) => c.state === "active").length <= 6);

  // 6. Duplicate church registration: same agent ×3 and another agent ×3 at once → one record.
  const agentUser = redeemed.find((r) => r.ok)!.id as number;
  const agentId = members[agentUser].id;
  await program.adminSetSupervisorLimit({ actorUserId: "u_pg_admin", supervisorUserId: "u_pg_sup", agentLimit: 10 });
  const extra = await program.createAgentInviteCode({ supervisorUserId: "u_pg_sup", maxUses: 1 });
  let secondAgent: string | null = null;
  if (extra) {
    secondAgent = members[1].id === agentId ? members[2].id : members[1].id;
    await program.redeemAgentInviteCode({ userId: secondAgent, code: extra.code });
  }
  const onboardJobs = [
    ...Array.from({ length: 3 }, () => ({ action: "onboard", agentUserId: agentId, supervisorUserId: "u_pg_sup", leaderKristoId: "KR7-PGLEADR1", churchId: "CH7-PGONE" })),
    ...(secondAgent ? Array.from({ length: 3 }, () => ({ action: "onboard", agentUserId: secondAgent, supervisorUserId: "u_pg_sup", leaderKristoId: "KR7-PGLEADR1", churchId: "CH7-PGONE" })) : []),
  ];
  const onboarded = await runWorkers(onboardJobs);
  const store = (await pool.query("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_program.json'")).rows[0].data;
  const forChurch = store.onboardings.filter((o: any) => o.churchId === "CH7-PGONE");
  assert.equal(forChurch.length, 1, "one record per church");
  assert.equal(onboarded.filter((r) => r.ok && r.created === true).length, 1, JSON.stringify(onboarded));
  const winner = forChurch[0].agentUserId;
  for (const r of onboarded) {
    const job = onboardJobs[r.id] as any;
    if (job.agentUserId === winner) assert.ok(r.ok, "the owning agent's repeats are idempotent");
    else assert.equal(r.status, 409);
  }

  // 7. Two conflicting leader answers at once → exactly one recorded.
  await program.submitTrainingReport({
    agentUserId: winner, onboardingId: forChurch[0].id, trainingTopics: ["Kuingia"], trainingCompleted: true, followUpStatus: "completed",
  });
  const [request] = await program.listLeaderConfirmations("u_pg_leader");
  const answers = await runWorkers(["confirm", "reject", "confirm", "needs_help"].map((response) => ({
    action: "respond", leaderUserId: "u_pg_leader", requestId: request.requestId, response,
  })));
  const finalRow = (await pool.query("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_program.json'")).rows[0]
    .data.onboardings.find((o: any) => o.id === forChurch[0].id);
  const answered = finalRow.leaderConfirmation.status;
  assert.ok(["confirmed", "rejected", "needs_help"].includes(answered));
  for (const r of answers) {
    const job = ["confirm", "reject", "confirm", "needs_help"][r.id];
    const same = { confirm: "confirmed", reject: "rejected", needs_help: "needs_help" }[job] === answered;
    assert.ok(same ? r.ok : r.status === 409, JSON.stringify(answers));
  }

  // 8. Legacy data still intact; no leftover locks.
  const agentsAfter = (await pool.query("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_agents.json'")).rows[0].data.agents;
  for (const legacy of legacyAgents) assert.ok(agentsAfter.some((a: any) => a.id === legacy.id && a.status === "accepted"));
  const codesAfter = (await pool.query("SELECT data FROM kristo_offline_activation_store WHERE key = 'offline_activation_codes.json'")).rows[0].data;
  assert.deepEqual(codesAfter, legacyCodes);
  const locks = await pool.query("SELECT count(*)::int AS n FROM kristo_offline_activation_locks");
  assert.equal(locks.rows[0].n, 0);
  console.log("PG_PROXY_STATS", JSON.stringify(proxy.stats));
});
