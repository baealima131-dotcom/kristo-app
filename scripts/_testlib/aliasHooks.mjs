import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

function tryFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const file = tryFile(base);
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  if (specifier === "next/server" || specifier === "next/headers") {
    return nextResolve(`${specifier}.js`, context);
  }
  return nextResolve(specifier, context);
}
