// scripts/install-hooks.mjs — den pre-commit-Hook aktivieren.
//
//   npm run hooks:install          installieren
//   npm run hooks:install -- --force   fremden Hook überschreiben
//   npm run hooks:install -- --remove  wieder entfernen
//
// Installiert wird nur ein Aufrufer: die eigentliche Logik bleibt in
// .githooks/pre-commit und ist damit versioniert. Änderungen dort wirken
// sofort, ohne erneute Installation.

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const git = (...args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

const root = git("rev-parse", "--show-toplevel");
if (!root) { console.error("Kein Git-Repository gefunden."); process.exit(1); }

// core.hooksPath gewinnt, sonst das gemeinsame .git/hooks (gilt auch in Worktrees)
const configured = git("config", "--get", "core.hooksPath");
const hooksDir = configured
  ? (isAbsolute(configured) ? configured : resolve(root, configured))
  : join(resolve(git("rev-parse", "--git-common-dir")), "hooks");

const target = join(hooksDir, "pre-commit");
const MARKER = "aborea-hook-shim";

const shim = `#!/bin/sh
# ${MARKER} — installiert von scripts/install-hooks.mjs
# Die Logik steht versioniert in .githooks/pre-commit.
root=$(git rev-parse --show-toplevel) || exit 0
[ -f "$root/.githooks/pre-commit" ] || exit 0
exec sh "$root/.githooks/pre-commit" "$@"
`;

if (process.argv.includes("--remove")) {
  if (!existsSync(target)) { console.log("Kein Hook installiert."); process.exit(0); }
  if (!readFileSync(target, "utf8").includes(MARKER) && !process.argv.includes("--force")) {
    console.error(`${target} stammt nicht von hier — mit --force entfernen.`);
    process.exit(1);
  }
  rmSync(target);
  console.log(`Entfernt: ${target}`);
  process.exit(0);
}

if (existsSync(target)) {
  const current = readFileSync(target, "utf8");
  if (current.includes(MARKER)) {
    console.log(`Bereits installiert: ${target}`);
    process.exit(0);
  }
  if (!process.argv.includes("--force")) {
    console.error(`${target} existiert bereits und stammt nicht von hier.`);
    console.error("Mit --force überschreiben, oder den bestehenden Hook selbst ergänzen.");
    process.exit(1);
  }
}

mkdirSync(hooksDir, { recursive: true });
writeFileSync(target, shim, { encoding: "utf8" });
try { chmodSync(target, 0o755); } catch { /* auf Windows irrelevant */ }

console.log(`Installiert: ${target}`);
console.log("Jeder Commit prüft jetzt Syntax und Tests. Überspringen: git commit --no-verify");
