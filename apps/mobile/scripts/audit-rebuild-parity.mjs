#!/usr/bin/env node
/**
 * Audit apps/mobile working tree vs homefeed-rebuild-clean.
 * Reports missing files, truncated files, unresolved imports, missing exports.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO = path.resolve(ROOT, "../..");
const BRANCH = "homefeed-rebuild-clean";

function gitShow(relPath) {
  try {
    return execSync(`git show ${BRANCH}:${relPath}`, {
      cwd: REPO,
      stdio: ["pipe", "pipe", "ignore"],
    }).toString();
  } catch {
    return null;
  }
}

function gitList(prefix) {
  return execSync(`git ls-tree -r --name-only ${BRANCH} ${prefix}`, { cwd: REPO })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
}

function lineCount(content) {
  return content ? content.split("\n").length : 0;
}

function resolveImport(fromFile, spec) {
  if (!spec) return null;
  if (spec.startsWith("@/")) {
    const base = path.join(ROOT, spec.slice(2));
    for (const e of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const p = base + e.replace(/^\//, e.startsWith("/") ? "" : "");
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  if (spec.startsWith(".")) {
    const dir = path.dirname(fromFile);
    const base = path.resolve(dir, spec);
    for (const e of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const p = e === "" ? base : base + e.replace(/^\//, "");
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

function getImportSpecs(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const specs = new Set();
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

function getValueImports(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const imports = [];
  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
      return;
    const spec = node.moduleSpecifier.text;
    if (!node.importClause) return;
    if (node.importClause.name && !node.importClause.isTypeOnly)
      imports.push({ name: "default", spec, alias: node.importClause.name.text });
    if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      node.importClause.namedBindings.elements.forEach((el) => {
        if (!el.isTypeOnly) {
          imports.push({
            name: el.propertyName?.text || el.name.text,
            alias: el.name.text,
            spec,
          });
        }
      });
    }
  });
  return imports;
}

function parseExports(filePath, cache = new Map()) {
  if (cache.has(filePath)) return cache.get(filePath);
  const src = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const exports = new Set();
  const reExports = [];
  sf.forEachChild((node) => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) exports.add("default");
    const isExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(node) && isExport)
      node.declarationList.declarations.forEach((d) => {
        if (ts.isIdentifier(d.name)) exports.add(d.name.text);
      });
    if (ts.isFunctionDeclaration(node) && isExport && node.name) exports.add(node.name.text);
    if (ts.isClassDeclaration(node) && isExport && node.name) exports.add(node.name.text);
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        node.exportClause.elements.forEach((el) => exports.add(el.name.text));
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        reExports.push(node.moduleSpecifier.text);
    }
  });
  const result = { exports, reExports };
  cache.set(filePath, result);
  return result;
}

function getAllExports(filePath, visited = new Set(), cache = new Map()) {
  if (visited.has(filePath)) return new Set();
  visited.add(filePath);
  const { exports, reExports } = parseExports(filePath, cache);
  const all = new Set(exports);
  for (const spec of reExports) {
    const target = resolveImport(filePath, spec);
    if (target) getAllExports(target, visited, cache).forEach((x) => all.add(x));
  }
  return all;
}

function collectTsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "_restore" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(collectTsFiles(p));
    else if (/\.(tsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

// --- File parity ---
const rebuildFiles = gitList("apps/mobile").filter(
  (f) => /\.(tsx?|jsx?)$/.test(f) && !f.includes("node_modules") && !f.includes("_restore")
);

const missing = [];
const truncated = [];
const present = [];

for (const rel of rebuildFiles) {
  const localRel = rel.replace(/^apps\/mobile\//, "");
  const localAbs = path.join(ROOT, localRel);
  const rebuildContent = gitShow(rel);
  const rebuildLines = lineCount(rebuildContent);
  if (!fs.existsSync(localAbs)) {
    missing.push({ rel: localRel, rebuildLines });
    continue;
  }
  const mainLines = lineCount(fs.readFileSync(localAbs, "utf8"));
  present.push(localRel);
  const ratio = rebuildLines > 0 ? mainLines / rebuildLines : 1;
  if (ratio < 0.7 && rebuildLines - mainLines > 30) {
    truncated.push({ rel: localRel, mainLines, rebuildLines, pct: Math.round(ratio * 100) });
  }
}

// --- Tab import graph ---
const TAB_SEEDS = [
  "app/(tabs)/index.tsx",
  "app/(tabs)/church/index.tsx",
  "app/(tabs)/church/overview.tsx",
  "app/(tabs)/church/members.tsx",
  "app/(tabs)/church/ministries/index.tsx",
  "app/(tabs)/more/index.tsx",
  "app/(tabs)/profile/index.tsx",
  "app/_layout.tsx",
  "index.js",
].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));

const SRC = path.join(ROOT, "src");
const APP = path.join(ROOT, "app");
const queue = [...TAB_SEEDS];
const visited = new Set();
const missingModules = [];
const missingExports = [];
const exportCache = new Map();

while (queue.length) {
  const f = queue.shift();
  if (!f || visited.has(f)) continue;
  visited.add(f);
  if (!fs.existsSync(f)) {
    missingModules.push({ spec: "(file missing)", from: path.relative(ROOT, f) });
    continue;
  }
  for (const spec of getImportSpecs(f)) {
    const resolved = resolveImport(f, spec);
    if (!resolved) {
      if (spec.startsWith("@/") || spec.startsWith("."))
        missingModules.push({ spec, from: path.relative(ROOT, f) });
      continue;
    }
    if (resolved.startsWith(SRC) || resolved.startsWith(APP)) queue.push(resolved);
  }
  for (const imp of getValueImports(f)) {
    const resolved = resolveImport(f, imp.spec);
    if (!resolved || (!resolved.startsWith(SRC) && !resolved.startsWith(APP))) continue;
    const exp = getAllExports(resolved, new Set(), exportCache);
    const lookup = imp.name;
    if (!exp.has(lookup) && !(lookup === "default" && exp.has("default"))) {
      missingExports.push({
        symbol: imp.alias || imp.name,
        exportedAs: imp.name,
        spec: imp.spec,
        importer: path.relative(ROOT, f),
        target: path.relative(ROOT, resolved),
      });
    }
  }
}

const uniqMissingMod = [...new Map(missingModules.map((m) => [`${m.spec}|${m.from}`, m])).values()];
const uniqMissingExp = [...new Map(missingExports.map((m) => [`${m.symbol}|${m.target}`, m])).values()];

const report = {
  summary: {
    rebuildSourceFiles: rebuildFiles.length,
    presentOnWorkingTree: present.length,
    missingFiles: missing.length,
    truncatedFiles: truncated.length,
    tabGraphFiles: visited.size,
    unresolvedLocalImports: uniqMissingMod.length,
    missingValueExports: uniqMissingExp.length,
  },
  missingFiles: missing.sort((a, b) => a.rel.localeCompare(b.rel)),
  truncatedFiles: truncated.sort((a, b) => a.pct - b.pct),
  unresolvedImports: uniqMissingMod.sort((a, b) => a.spec.localeCompare(b.spec)),
  missingExports: uniqMissingExp.sort((a, b) => a.symbol.localeCompare(b.symbol)),
};

const outPath = path.join(ROOT, "scripts/audit-rebuild-parity-report.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report.summary, null, 2));
console.log("\n--- Missing files ---");
report.missingFiles.slice(0, 50).forEach((m) => console.log(`  ${m.rel} (${m.rebuildLines}L)`));
if (report.missingFiles.length > 50) console.log(`  ... +${report.missingFiles.length - 50} more`);

console.log("\n--- Truncated files (worst 40) ---");
report.truncatedFiles.slice(0, 40).forEach((t) =>
  console.log(`  ${t.rel}: ${t.mainLines}/${t.rebuildLines} (${t.pct}%)`)
);
if (report.truncatedFiles.length > 40) console.log(`  ... +${report.truncatedFiles.length - 40} more`);

console.log("\n--- Unresolved local imports ---");
report.unresolvedImports.forEach((m) => console.log(`  ${m.spec} <- ${m.from}`));

console.log("\n--- Missing value exports ---");
report.missingExports.forEach((m) =>
  console.log(`  ${m.symbol} (import ${m.exportedAs} from ${m.spec}) in ${m.target} <- ${m.importer}`)
);

console.log(`\nFull report: ${outPath}`);
