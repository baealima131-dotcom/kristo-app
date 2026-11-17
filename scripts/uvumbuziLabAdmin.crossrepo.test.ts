/**
 * Cross-repo check: the real UVUMBUZI Lab server (admin panel API) talking to the
 * real Kristo admin routes, in one process, on a throw-away filesystem store with
 * fixture accounts. The Lab's outbound fetch is routed to Kristo's route handlers,
 * so nothing leaves this machine.
 *
 *   UVUMBUZI_LAB_DIR=../uvumbuzi-lab-admin-review \
 *   node --test --import ./scripts/_testlib/aliasLoader.mjs scripts/uvumbuziLabAdmin.crossrepo.test.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labDir = path.resolve(repoRoot, process.env.UVUMBUZI_LAB_DIR || "../uvumbuzi-lab-admin-review");
const labServer = path.join(labDir, "src/server/server.ts");

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-lab-admin-"));
process.chdir(dataRoot);
for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "NEON_DATABASE_URL", "VERCEL"]) {
  delete process.env[key];
}
process.env.KRISTO_SESSION_SECRET = "crossrepo-test-session-secret-0123456789";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.UVUMBUZI_BRIDGE_PRIVATE_KEY_PEM_BASE64 = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "pem" }) as string
).toString("base64");
process.env.UVUMBUZI_BRIDGE_ISSUER = "kristo-crossrepo-test";
process.env.UVUMBUZI_BRIDGE_AUDIENCE = "uvumbuzi-lab-crossrepo-test";

const dataDir = path.join(dataRoot, "data");
fs.mkdirSync(dataDir, { recursive: true });
const put = (file: string, value: unknown) => fs.writeFileSync(path.join(dataDir, file), JSON.stringify(value));
const ADMIN = { id: "u_xr_admin", kristoId: "KR7-XRADMIN1" };
const SUP = { id: "u_xr_super", kristoId: "KR7-XRSUPER1" };
const CHURCH = "CH7-XRHOME";
put("users.json", [ADMIN, SUP].map((u) => ({ id: u.id, kristoId: u.kristoId, password: "x" })));
put("profiles.json", Object.fromEntries([ADMIN, SUP].map((u) => [u.id, { userId: u.id, userCode: u.kristoId, fullName: u.id }])));
put("churches.json", [{ id: CHURCH, name: "Crossrepo Church" }]);
put("memberships.json", [
  { id: "m1", userId: SUP.id, churchId: CHURCH, status: "Active", churchRole: "Member", createdAt: "2026-10-01T00:00:00Z" },
]);
put("platform_roles.json", [{ userId: ADMIN.id, platformRole: "System_Admin", updatedAt: "2026-10-01T00:00:00Z" }]);

const { NextRequest } = await import("next/server.js");
const { issueSessionToken } = await import("../app/api/auth/_lib/sessionToken.ts");
const { deletePlatformRole, upsertPlatformRole } = await import("@/app/api/_lib/platformRoles");

/** Lab → Kristo: dispatch to the matching Kristo route handler in-process. */
async function kristoFetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const u = new URL(url);
  assert.equal(u.origin, "https://kristo.invalid", "the Lab only calls the configured Kristo origin");
  const allowed =
    u.pathname === "/api/uvumbuzi/admin/session" ||
    /^\/api\/offline-activation\/program\/admin\/[a-z/-]+$/.test(u.pathname);
  assert.ok(allowed, `unexpected Lab → Kristo path ${u.pathname}`);
  const mod = await import(`@/app${u.pathname}/route`);
  const res = await mod[init.method](
    new NextRequest(new URL(u.pathname + u.search, "http://localhost"), {
      method: init.method,
      headers: init.headers,
      body: init.body,
    })
  );
  return { status: res.status as number, json: () => res.json() };
}

test("Lab admin page ↔ Kristo admin routes, end to end", { skip: !fs.existsSync(labServer) && `Lab not found at ${labDir}` }, async (t) => {
  const { startServer } = await import(pathToFileURL(labServer).href);
  const lab = await startServer({
    port: 0,
    dbPath: path.join(dataRoot, "lab.db"),
    kristoConfig: {
      issuer: process.env.UVUMBUZI_BRIDGE_ISSUER,
      audience: process.env.UVUMBUZI_BRIDGE_AUDIENCE,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    kristoAdmin: { kristoBaseUrl: "https://kristo.invalid" },
    kristoAdminFetch: kristoFetch,
  });
  t.after(async () => {
    await lab.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const labCall = async (p: string, opts: { cookie?: string; body?: unknown } = {}) => {
    const r = await fetch(lab.url + p, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.body === undefined ? {} : { "x-uvumbuzi-admin": "1" }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    return { status: r.status, body: (await r.json()) as any, setCookie: r.headers.get("set-cookie") };
  };

  // 1. Admin gets a one-time code from Kristo (signed mobile session).
  const codeRoute = await import("@/app/api/uvumbuzi/admin/login-code/route");
  const codeRes = await codeRoute.POST(
    new NextRequest("http://localhost/api/uvumbuzi/admin/login-code", {
      method: "POST",
      headers: { "x-kristo-session-token": issueSessionToken(ADMIN.id) },
    })
  );
  const { code } = await codeRes.json();
  assert.equal(codeRes.status, 201);

  // 2. Lab exchanges it and verifies the admin pass with Kristo's public key.
  const signIn = await labCall("/api/kristo/admin/session", { body: { code } });
  assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
  const cookie = signIn.setCookie!.split(";")[0];
  assert.equal((await labCall("/api/kristo/admin/session", { body: { code } })).status, 401, "codes are single use");

  // 3. Admin invites a supervisor with a limit, through the Lab.
  const invite = await labCall("/api/kristo/admin/supervisors", {
    cookie,
    body: { kristoId: SUP.kristoId, churchId: CHURCH, agentLimit: 3 },
  });
  assert.equal(invite.status, 200, JSON.stringify(invite.body));
  assert.equal(invite.body.outcome, "invited");
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "offline_activation_invitations.json"), "utf8"));
  assert.ok(JSON.stringify(stored).includes(SUP.id), "invitation stored in Kristo (in-app only, no notification sent)");

  const overview = await labCall("/api/kristo/admin/overview", { cookie });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.overview.totals);

  const audit = await labCall("/api/kristo/admin/audit", { cookie });
  const actions = audit.body.events.map((e: any) => e.action);
  assert.ok(actions.includes("admin.session_issued") && actions.includes("supervisor.invited"));

  // 4. Kristo re-checks the role on every call: removing System_Admin ends access at once.
  await deletePlatformRole(ADMIN.id);
  assert.equal((await labCall("/api/kristo/admin/overview", { cookie })).status, 403);
  await upsertPlatformRole(ADMIN.id, "System_Admin", "restored by test");
  assert.equal((await labCall("/api/kristo/admin/overview", { cookie })).status, 200);

  // 5. The Lab cannot be used to reach non-admin Kristo routes or legacy Lab APIs with this session.
  assert.equal((await labCall("/api/kristo/bridge/me", { cookie })).status, 401);
});
