// Source-contract checks only: not a substitute for TypeScript, SQL, or device tests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = readFileSync('app/api/_lib/store/sokoSellerAccessDb.ts', 'utf8');
const route = readFileSync('app/api/soko/seller/system-messages/route.ts', 'utf8');
const ui = readFileSync('apps/mobile/src/components/messages/SokoSystemMessages.tsx', 'utf8');
const inbox = readFileSync('apps/mobile/app/(tabs)/more/my-church-room/messages/index.tsx', 'utf8');
let count = 0;
function check(name, predicate) { assert.ok(predicate, name); count++; console.log(`PASS ${name}`); }
check('endpoint authenticates', route.includes('await guardAuth(req)'));
check('recipient comes from auth', route.includes('dbGetMySokoSystemMessages(auth.viewer.userId)'));
check('no recipient query parameter', !route.includes('searchParams'));
check('read-only endpoint', !/export async function (POST|PATCH|DELETE)/.test(route));
check('private no-store response', route.includes('private, no-store'));
check('owner-filtered message query', db.includes('WHERE message.recipient_user_id = ${recipient}'));
check('no code in notice text snapshot', db.includes('decision TEXT NOT NULL,\n        code_id TEXT UNIQUE'));
check('code hidden unless active and unexpired', db.includes("CASE WHEN code.status = 'active' AND code.expires_at > NOW()"));
check('approval required for visible code', db.includes("AND application.status = 'approved'\n        THEN code.code_value"));
check('notice and code inserted in same statement', /insert_code AS \([\s\S]*insert_notice AS \([\s\S]*FROM update_application/.test(db));
check('approve/reject conditional state transition', db.includes("(${decision} IN ('approve', 'reject') AND status = 'pending')"));
check('regenerate cooldown', db.includes("INTERVAL '10 seconds'"));
check('no broad revocation if transition fails', db.includes('WHERE application_id IN (SELECT id FROM update_application)'));
check('existing inbox integrates component', inbox.includes('<SokoSystemMessages />'));
check('UI checks session before accepting response', ui.includes('now?.sessionToken === session?.sessionToken'));
check('UI cancels on blur', ui.includes('pending.current?.abort()'));
check('UI hides notices on failed refresh', /catch \{[\s\S]*setMessages\(\[\]\)/.test(ui));
check('UI checks code expiry', ui.includes('Date.parse(message.codeExpiresAt) > Date.now()'));
console.log(`${count} source-contract checks passed. Runtime and integration tests remain required.`);
