#!/usr/bin/env node
/**
 * Start Expo dev-client Metro with KRISTO_IOS_V1_FREE_PROOF_SECRET loaded so
 * app.config.js can bake iosV1FreeProofSecret into extra (source: "extra").
 * Never prints the secret — only presence + sha12 fingerprint.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const secretPath = join(homedir(), ".cursor", "kristo-ios-v1-free-proof.secret");
const env = { ...process.env };

if (!String(env.KRISTO_IOS_V1_FREE_PROOF_SECRET || "").trim()) {
  if (!existsSync(secretPath)) {
    console.error(
      `[start-dev] missing ${secretPath} and KRISTO_IOS_V1_FREE_PROOF_SECRET unset — client will use dev_fallback`
    );
  } else {
    const secret = String(readFileSync(secretPath, "utf8") || "").trim();
    if (!secret) {
      console.error(`[start-dev] empty secret file at ${secretPath}`);
    } else {
      env.KRISTO_IOS_V1_FREE_PROOF_SECRET = secret;
      const sha12 = createHash("sha256").update(secret).digest("hex").slice(0, 12);
      console.log(`[start-dev] iosV1 proof secret loaded len=${secret.length} sha12=${sha12}`);
    }
  }
} else {
  const secret = String(env.KRISTO_IOS_V1_FREE_PROOF_SECRET).trim();
  const sha12 = createHash("sha256").update(secret).digest("hex").slice(0, 12);
  console.log(`[start-dev] iosV1 proof secret from env len=${secret.length} sha12=${sha12}`);
}

const child = spawn(
  "npx",
  ["expo", "start", "--dev-client", "-c", "--host", "lan", "--port", "8084"],
  {
    cwd: join(import.meta.dirname, ".."),
    env,
    stdio: "inherit",
  }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
