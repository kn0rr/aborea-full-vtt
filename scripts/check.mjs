// scripts/check.mjs — Syntaxprüfung + Testsuite in einem Lauf.
//
// Das ist, was der pre-commit-Hook ausführt. Direkt aufrufbar mit:
//   node scripts/check.mjs      (oder: npm run check)

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run  = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", ...opts });

let failed = false;

// ── 1. Syntax aller Systemmodule ──────────────────────────────────────────
// Fängt Tippfehler ab, bevor Foundry sie als weißen Bildschirm zeigt.
const moduleDir = join(root, "module");
const modules = existsSync(moduleDir)
  ? readdirSync(moduleDir).filter(f => f.endsWith(".mjs")).map(f => join("module", f))
  : [];

const broken = [];
for (const file of modules) {
  const res = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
  if (res.status !== 0) {
    broken.push(file);
    process.stderr.write(`\n✖ Syntaxfehler in ${file}\n${res.stderr ?? ""}`);
  }
}
if (broken.length) failed = true;
else console.log(`✔ Syntax: ${modules.length} Module in Ordnung`);

// ── 2. Testsuite ──────────────────────────────────────────────────────────
console.log("");
const tests = run(["--test", "tests/**/*.test.mjs"]);
if (tests.status !== 0) failed = true;

if (failed) {
  process.stderr.write("\n✖ Prüfung fehlgeschlagen.\n");
  process.exit(1);
}
console.log("\n✔ Alle Prüfungen bestanden.");
