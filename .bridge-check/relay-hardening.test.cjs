/** Offline test of REAL exported Kristo code (no Next server, no network). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.Node10
  }}).outputText, filename);
const root = path.resolve(__dirname, '..');
const lib = require(path.join(root, 'app/api/_lib/uvumbuziLabProxy.ts'));
const {issueUvumbuziBridgeToken} = require(path.join(root, 'app/api/_lib/uvumbuziBridgeToken.ts'));
const {privateKey,publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
const cfg = {labUrl:'https://lab.example.test', bridge:{privateKey,issuer:'kristo.test',audience:'uvumbuzi.test'}};
let nextRequests=[];
const fakeFetch = async (url, opts) => {
  nextRequests.push({url,opts});
  return {ok:true,status:200,json:async()=>({subject:'u_demo',projects:[]})};
};
function call(method, segments, body, extras={}) {
  nextRequests=[];
  return lib.proxyToLab({method,segments,bodyText:body===undefined?undefined:JSON.stringify(body),
    verifiedUserId:'u_demo', config:cfg,fetchImpl:fakeFetch,
    audit:()=>{},
    limits:{calls:new lib.RelayRateLimiter(100,60000),invites:new lib.RelayRateLimiter(100,60000)},
    ...extras});
}
test('real lab routes strictly allowlisted',()=>{
 assert.equal(lib.isAllowedLabRoute('GET',['me']),true);
 assert.equal(lib.isAllowedLabRoute('POST',['projects','p_1','members']),true);
 assert.equal(lib.isAllowedLabRoute('GET',['link-project']),false);
 assert.equal(lib.isAllowedLabRoute('POST',['link-project']),false);
 assert.equal(lib.isAllowedLabRoute('GET',['projects','../etc','history']),false);
 assert.equal(lib.isAllowedLabRoute('POST',['projects','p_1','delete']),false);
});
test('invite refuses internal subject-only identity even from owner', async()=>{
 const r=await call('POST',['projects','p_1','members'],{subject:'u_victim'});
 assert.equal(r.status,400);assert.equal(nextRequests.length,0);
});
test('invite refuses unknown fields mixed with public ID', async()=>{
 const r=await call('POST',['projects','p_1','members'],{kristoId:'KR7-ABCDEF',subject:'u_victim'});
 assert.equal(r.status,400);assert.equal(nextRequests.length,0);
});
test('invite resolves public Kristo ID server-side and strips the public ID',async()=>{
 let lookedUp='';
 const people={resolveKristoId:async id=>(lookedUp=id,'u_found'),publicIds:async()=>({})};
 const r=await call('POST',['projects','p_1','members'],{kristoId:'kr7-abcdef'},{people});
 assert.equal(r.status,200);assert.equal(lookedUp,'KR7-ABCDEF');
 assert.deepEqual(JSON.parse(nextRequests[0].opts.body),{subject:'u_found'});
 assert.ok(nextRequests[0].opts.headers.authorization.startsWith('Bearer '));
});
test('invalid public Kristo ID blocked before directory call',async()=>{
 let count=0;
 const r=await call('POST',['projects','p_1','members'],{kristoId:'u_victim'},{people:{resolveKristoId:async()=>{count++;return 'u_found'}}});
 assert.equal(r.status,400);assert.equal(count,0);
});
test('unknown public Kristo ID returns 404, never calls Lab',async()=>{
 const r=await call('POST',['projects','p_1','members'],{kristoId:'KR7-UNKNOWN'},{people:{resolveKristoId:async()=>null}});
 assert.equal(r.status,404);assert.equal(nextRequests.length,0);
});
test('request without signed identity refused before Lab',async()=>{
 const r=await call('GET',['me'],undefined,{verifiedUserId:''});
 assert.equal(r.status,401);assert.equal(nextRequests.length,0);
});
test('Lab key never shared with Kristo session secret',()=>{
 const token=issueUvumbuziBridgeToken('u_demo',cfg.bridge).token;
 const [header,payload,signature]=token.split('.');
 assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'RS256');
 const c=JSON.parse(Buffer.from(payload,'base64url'));
 assert.equal(c.sub,'u_demo');assert.equal(c.iss,'kristo.test');assert.equal(c.aud,'uvumbuzi.test');
 assert.ok(c.exp-c.iat<=300);
 assert.equal(crypto.verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')),true);
});
test('direct bearer-token route is closed in staging patch',()=>{
 const source=fs.readFileSync(path.join(root,'app/api/uvumbuzi/token/route.ts'),'utf8');
 assert.match(source,/relay_only/);assert.doesNotMatch(source,/issueUvumbuziBridgeToken/);
});
test('invalid remote URL / partial config cannot enable relay',()=>{
 const env={UVUMBUZI_LAB_URL:'http://outside.example.test',UVUMBUZI_BRIDGE_ISSUER:'x',UVUMBUZI_BRIDGE_AUDIENCE:'y',UVUMBUZI_BRIDGE_PRIVATE_KEY_PEM_BASE64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};
 assert.equal(lib.labProxyConfigFromEnv(env),null);
 assert.ok(lib.labProxyConfigFromEnv({...env,UVUMBUZI_LAB_URL:'https://lab.example.test'}));
});
