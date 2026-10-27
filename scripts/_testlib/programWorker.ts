/**
 * One "server instance" for the Postgres concurrency test: a separate Node
 * process that waits for a shared start time, runs one program operation and
 * prints a JSON line with the outcome.
 */
const job = JSON.parse(process.argv[2] || "{}");
const program = await import("../../app/api/_lib/offlineActivationProgram.ts");
const admin = await import("../../app/api/_lib/offlineActivationAdmin.ts");

const programDb = await import("../../app/api/_lib/store/offlineActivationProgramDb.ts");
const agentStore = await import("../../app/api/_lib/offlineActivationAgentStore.ts");
const invitations = await import("../../app/api/_lib/offlineActivationInvitations.ts");

const actions: Record<string, () => Promise<unknown>> = {
  initProgramSchema: () => programDb.ensureProgramSchema(),
  legacyUpdate: () => agentStore.updateSupervisorAgent({ supervisorUserId: job.supervisorUserId, agentId: job.agentId, status: job.status }),
  legacyRemove: async () => {
    if (!(await agentStore.deleteSupervisorAgent(job.supervisorUserId, job.agentId))) throw Object.assign(new Error("Agent not found."), { status: 404 });
  },
  respondInvitation: () => invitations.respondToInvitation({ invitationId: job.invitationId, inviteeUserId: job.userId, action: job.response }),
  redeem: () => program.redeemAgentInviteCode({ userId: job.userId, code: job.code }),
  createCode: () => program.createAgentInviteCode({ supervisorUserId: job.supervisorUserId, maxUses: 1, expiresInHours: 1 }),
  legacyInvite: () => admin.inviteAgentByKristoAndChurch(job.kristoId, job.churchId, job.supervisorUserId),
  onboard: () =>
    program.upsertChurchOnboarding({
      agentUserId: job.agentUserId,
      supervisorUserId: job.supervisorUserId,
      leaderKristoId: job.leaderKristoId,
      churchId: job.churchId,
    }),
  respond: () =>
    program.respondLeaderConfirmation({ leaderUserId: job.leaderUserId, requestId: job.requestId, response: job.response }),
};

// Warm up (schema check, connections) BEFORE the shared start time, so the
// operations themselves really run at the same moment.
if (job.action !== "initProgramSchema" && process.env.DATABASE_URL) {
  await programDb.ensureProgramSchema();
  // Cold-start reads of the other stores (memberships/profiles schema checks) also happen
  // before the barrier, so they cannot stagger the operations under test.
  const { getActiveMembership } = await import("../../app/api/_lib/memberships.ts");
  const { getProfile } = await import("../../app/api/auth/_lib/profile.ts");
  const { getPlatformRole } = await import("../../app/api/_lib/platformRoles.ts");
  const warmUser = String(job.userId || job.supervisorUserId || "u_warmup");
  await Promise.all([getActiveMembership(warmUser), getProfile(warmUser), getPlatformRole(warmUser)]).catch(() => null);
}
await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(job.startAt) - Date.now())));
const startedAt = Date.now();
try {
  const result: any = await actions[job.action]();
  process.stdout.write(
    `RESULT ${JSON.stringify({ ok: true, id: job.id, created: result?.created, outcome: result?.outcome, startedAt, lateMs: startedAt - Number(job.startAt) })}\n`
  );
} catch (error: any) {
  process.stdout.write(
    `RESULT ${JSON.stringify({ ok: false, id: job.id, status: error?.status || 0, error: String(error?.message || error), startedAt, lateMs: startedAt - Number(job.startAt) })}\n`
  );
}
process.exit(0);
