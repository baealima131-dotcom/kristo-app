import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function load(file, imports, env = {}) {
  const context = vm.createContext({ console, Buffer, process: { env }, Date });
  const module = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(root, file), 'utf8')), { context });
  await module.link(async name => {
    assert.ok(name in imports, `Unmocked import ${name}`);
    const values = imports[name];
    return new vm.SyntheticModule(Object.keys(values), function() { for (const [k,v] of Object.entries(values)) this.setExport(k,v); }, { context });
  });
  await module.evaluate();
  return module.namespace;
}
const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
const versions = { termsVersion: 't1', privacyVersion: 'p1', marketplaceRulesVersion: 'm1', safetyVersion: 's1' };
const valid = { email: 'buyer@example.com', password: 'long password', fullName: 'Buyer One', agreedToTerms: true, policyVersions: versions };
const request = body => ({ json: async () => body });
async function signup(sent = true) {
  const calls = [];
  const route = await load('app/api/soko/auth/sign-up/route.ts', {
    'next/server': next,
    '@/app/api/auth/_lib/session': { createUser: async input => { calls.push(['create',input]); return { ok: true, user: { id:'u1' } }; }, rollbackSignupUser: async id => calls.push(['rollback',id]) },
    '@/app/api/auth/_lib/profile': { ensureProfileDraft: async () => {} },
    '@/app/api/_lib/email': { sendVerificationCodeEmail: async () => ({ ok: sent }) },
    '@/app/api/_lib/store/zporaIdentityDb': { createZporaIdentity: async () => ({ challengeId:'c1', code:'123456' }), deleteZporaIdentity: async id => calls.push(['delete-origin',id]), ensureZporaIdentitySchema: async () => {} },
    '@/app/api/_lib/sokoLegalPolicy': { publicSokoPolicyBundle: () => ({ versions }) },
  });
  return { route, calls };
}
test('signup rejects unaccepted or stale policies before creating any user', async () => {
  for (const change of [{ agreedToTerms:false }, { policyVersions: { ...versions, termsVersion:'old' } }]) {
    const { route,calls } = await signup();
    assert.equal((await route.POST(request({ ...valid,...change }))).status,400);
    assert.equal(calls.length,0);
  }
});
test('signup validates name, email and password before writing', async () => {
  for (const change of [{ fullName:'' }, { email:'invalid' }, { password:'123' }, { password:'x'.repeat(129) }]) {
    const { route,calls } = await signup();
    assert.equal((await route.POST(request({ ...valid,...change }))).status,400);
    assert.equal(calls.length,0);
  }
});
test('successful signup returns a challenge without session credentials or code', async () => {
  const { route } = await signup();
  const result = await route.POST(request(valid));
  assert.equal(result.status,200);
  assert.equal(result.body.challengeId,'c1');
  assert.equal(result.body.needsVerification,true);
  assert.equal(result.body.sessionToken,undefined);
  assert.equal(result.body.code,undefined);
});
test('failed email delivery removes both new identity and account', async () => {
  const { route,calls } = await signup(false);
  assert.equal((await route.POST(request(valid))).status,503);
  assert.ok(calls.some(([kind]) => kind === 'rollback'));
  assert.ok(calls.some(([kind]) => kind === 'delete-origin'));
});
async function challengeStore() {
  const rows = new Map();
  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g,' ');
    if (q.includes('CREATE TABLE')) return [];
    if (q.includes('INSERT INTO')) { rows.set(values[0], { userId:values[0], challengeId:values[1], hash:values[2], expires:Date.now()+600000, sent:Date.now(), attempts:0, verified:false, shared:false }); return []; }
    if (q.includes('SET attempts = attempts + 1')) {
      const row = [...rows.values()].find(r => r.challengeId === values[0] && !r.verified && r.expires > Date.now() && r.attempts < 5);
      if (!row) return [];
      row.attempts++;
      return [{ user_id:row.userId,code_hash:row.hash }];
    }
    if (q.includes('SET verified_at = NOW()')) {
      const row=rows.get(values[0]);
      if (!row || row.verified || row.challengeId !== values[1]) return [];
      row.verified=true;row.challengeId=null;row.hash=null;return [{user_id:row.userId}];
    }
    if (q.includes('SET challenge_id =')) {
      const row=rows.get(values[2]);
      if (!row || row.verified || row.sent > Date.now()-60000) return [];
      row.challengeId=values[0];row.hash=values[1];row.attempts=0;row.expires=Date.now()+600000;row.sent=Date.now();return [{user_id:row.userId}];
    }
    throw new Error(`Unhandled SQL: ${q}`);
  };
  const store = await load('app/api/_lib/store/zporaIdentityDb.ts', { crypto: { default:crypto }, '@neondatabase/serverless': { neon: () => sql }, './authDb': { getDatabaseUrl: () => 'mock' } }, { KRISTO_SESSION_SECRET:'test-secret' });
  return { store,rows };
}
test('verification stores a hash, consumes one code and rejects replay', async () => {
  const { store,rows } = await challengeStore();const c=await store.createZporaIdentity('u1');
  assert.notEqual(rows.get('u1').hash,c.code);
  assert.equal(await store.verifyZporaChallenge(c.challengeId,c.code),'u1');
  await assert.rejects(store.verifyZporaChallenge(c.challengeId,c.code));
});
test('concurrent wrong codes cannot bypass the five-attempt limit', async () => {
  const { store,rows } = await challengeStore();const c=await store.createZporaIdentity('u1');
  await Promise.allSettled(Array.from({length:10}, () => store.verifyZporaChallenge(c.challengeId,'000000')));
  assert.equal(rows.get('u1').attempts,5);
  await assert.rejects(store.verifyZporaChallenge(c.challengeId,c.code));
});
test('expired codes fail and resend is limited to once per minute', async () => {
  const { store,rows } = await challengeStore();const c=await store.createZporaIdentity('u1');
  rows.get('u1').expires=Date.now()-1;
  await assert.rejects(store.verifyZporaChallenge(c.challengeId,c.code));
  await assert.rejects(store.resendZporaChallenge('u1'));
  rows.get('u1').sent=Date.now()-61000;
  const replacement=await store.resendZporaChallenge('u1');
  assert.notEqual(replacement.challengeId,c.challengeId);
  await assert.rejects(store.verifyZporaChallenge(c.challengeId,c.code));
  assert.equal(await store.verifyZporaChallenge(replacement.challengeId,replacement.code),'u1');
});
async function deletion(origin, memberships = [], failImages = false) {
  const calls=[];
  class NextResponse { constructor(body,status=200) { this.body=body;this.status=status; } static json(body,options={}) { return new this(body,options.status || 200); } }
  const route=await load('app/api/soko/account/route.ts', {
    'next/server': { NextResponse, NextRequest: class {} },
    '@neondatabase/serverless': { neon: () => async (strings) => { const q=strings.join('?'); if (q.includes('to_regclass')) return [{name:null}]; throw new Error(`Unhandled SQL ${q}`); } },
    '@/app/api/_lib/rbac': { guardCheckoutAuth: async () => ({viewer:{userId:'u1'}}) },
    '@/app/api/_lib/store/authDb': { getDatabaseUrl: () => 'mock' },
    '@/app/api/_lib/store/zporaIdentityDb': { getZporaIdentity: async () => origin, deleteZporaIdentity: async () => calls.push('delete-origin') },
    '@/app/api/auth/_lib/session': { deleteChallengesForUser: () => calls.push('delete-challenges'), deleteUserById: async () => calls.push('delete-user') },
    '@/app/api/_lib/memberships': { getMembershipsForUser: async () => memberships },
    '@/app/api/_lib/store/sokoAccountStateDb': { markSokoAccountDeleted: async () => calls.push('mark-deleted') },
    '@/app/api/_lib/sokoProductImages': { sokoImageOwner: id => id },
    '@/app/api/_lib/media/objectStorage': { deleteSokoProductImagesByOwner: async () => { if(failImages) throw new Error('storage unavailable'); calls.push('delete-images'); } },
  });
  return { route,calls };
}
test('deleting a Zpora-only account deletes its login and origin record', async () => {
  const {route,calls}=await deletion({shared_with_kristo:false,verified_at:'today'});
  const result=await route.DELETE({});
  assert.equal(result.body.ok,true);assert.equal(result.body.kristoAccountPreserved,false);
  assert.ok(calls.includes('delete-user'));assert.ok(calls.includes('delete-origin'));
});
test('existing Kristo identities, adopted identities and church members retain Kristo login', async () => {
  for (const [origin,memberships] of [[null,[]],[{shared_with_kristo:true},[]],[{shared_with_kristo:false},[{id:'church-member'}]]]) {
    const {route,calls}=await deletion(origin,memberships);
    assert.equal((await route.GET({})).body.kristoAccountPreserved,true);
    assert.equal((await route.DELETE({})).body.kristoAccountPreserved,true);
    assert.equal(calls.includes('delete-user'),false);
  }
});
test('failed deletion does not claim completion or remove login before storage cleanup', async () => {
  const {route,calls}=await deletion({shared_with_kristo:false},[],true);
  const result=await route.DELETE({});
  assert.equal(result.status,500);assert.equal(result.body.ok,false);
  assert.equal(calls.includes('mark-deleted'),false);assert.equal(calls.includes('delete-user'),false);
});
