// Test-only resolve hook: maps the Next.js "@/..." alias to the repo root and
// lets extension-less TypeScript imports resolve under plain `node --test`.
import { register } from "node:module";

register("./aliasHooks.mjs", import.meta.url);
