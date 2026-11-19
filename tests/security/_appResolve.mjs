// Test-only module resolution for importing app code under plain `node --test`:
// maps the "@/..." alias to the repo root and Next's extensionless subpaths to their .js files.
//   node --import ./tests/security/_appResolve.mjs --test tests/security/otpChallenge.test.ts
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(process.cwd() + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const root = ${JSON.stringify(root)};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = root + specifier.slice(2);
    for (const ext of [".ts", ".tsx", "/index.ts", ""]) {
      try { return await next(base + ext, context); } catch {}
    }
  }
  if (/^next\\/(headers|server|navigation)$/.test(specifier)) return next(specifier + ".js", context);
  return next(specifier, context);
}`)
);
