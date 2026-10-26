/**
 * One "server instance" for the Postgres concurrency test: a separate Node
 * process that waits for a shared start time, runs one program operation and
 * prints a JSON line with the outcome.
 */
const job = JSON.parse(process.argv[2] || "{}");
const program = await import("../../app/api/_lib/offlineActivationProgram.ts");
const admin = await import("../../app/api/_lib/offlineActivationAdmin.ts");

const invitationDb = await import("../../app/api/_lib/store/offlineActivationInvitationDb.ts");
const storeDb = await import("../../app/api/_lib/store/offlineActivationDb.ts");

const actions: Record<string, () => Promise<unknown>> = {
  initInvitationSchema: () =>
    Promise.all([invitationDb.ensureOfflineActivationInvitationSchema(), storeDb.ensureOfflineActivationStoreReady()]),
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

await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(job.startAt) - Date.now())));
try {
  const result: any = await actions[job.action]();
  process.stdout.write(
    `RESULT ${JSON.stringify({ ok: true, id: job.id, created: result?.created, outcome: result?.outcome })}\n`
  );
} catch (error: any) {
  process.stdout.write(
    `RESULT ${JSON.stringify({ ok: false, id: job.id, status: error?.status || 0, error: String(error?.message || error) })}\n`
  );
}
process.exit(0);
