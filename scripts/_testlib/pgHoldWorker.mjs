// Test-only: open a real Postgres transaction, run one program function inside it,
// report "LOCKED", sleep, then COMMIT ("COMMITTED"). Used to hold locks for a long
// time (>20 s) or to be killed half-way (SIGKILL) by the Postgres concurrency test.
//   node pgHoldWorker.mjs <toolsDir> <connectionString> <sleepSeconds> <sql> [json params]
import { createRequire } from "node:module";
import path from "node:path";

const [toolsDir, connectionString, sleepSeconds, text, paramsJson] = process.argv.slice(2);
const require = createRequire(path.join(toolsDir, "package.json"));
const pg = require("pg");
const client = new pg.Client({ connectionString });
await client.connect();
// Lets Postgres notice a dead client during a long statement (PG14+).
await client.query("SET client_connection_check_interval = '500ms'");
await client.query("BEGIN");
try {
  const result = await client.query(text, paramsJson ? JSON.parse(paramsJson) : []);
  process.stdout.write(`LOCKED ${JSON.stringify(result.rows[0] || {})}\n`);
  await client.query(`SELECT pg_sleep(${Number(sleepSeconds)})`);
  await client.query("COMMIT");
  process.stdout.write("COMMITTED\n");
} catch (error) {
  process.stdout.write(`ERROR ${String(error?.message || error)}\n`);
  await client.query("ROLLBACK").catch(() => {});
}
await client.end();
