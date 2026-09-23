// tests/helpers/source.mjs — den eigenen Quelltext lesen
//
// Manches lässt sich nicht am Verhalten prüfen, weil das Verhalten in Foundry
// steckt: ob ein Werkzeug erscheint, ob ein Reiter rendert. Aber der Aufruf,
// der dahin führt, steht bei uns — und der ist prüfbar.
//
// Solche Prüfungen sind bewusst grob: sie lesen Text, nicht Bedeutung. Dafür
// halten sie Fallen fest, die schon einmal zugeschnappt sind.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MODULE_DIR = new URL("../../module/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Alle Systemmodule als {name, pfad, quelle}. */
export function moduleFiles() {
  return readdirSync(MODULE_DIR).filter(f => f.endsWith(".mjs")).map(name => ({
    name,
    pfad:   join(MODULE_DIR, name),
    quelle: readFileSync(join(MODULE_DIR, name), "utf8"),
  }));
}

/**
 * Entfernt Kommentare und Zeichenketten, lässt die Zeilenzählung aber heil —
 * sonst zeigt der Fehler auf die falsche Stelle.
 */
export function stripCommentsAndStrings(source) {
  const keepNewlines = m => "\n".repeat((m.match(/\n/g) ?? []).length);
  return source
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, keepNewlines)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/** Findet einen Namen als eigenständigen Bezeichner, nicht als .eigenschaft. */
export function findIdentifier(source, name) {
  const re = new RegExp(`(?<![.\\w$])${name}(?![\\w$])`, "g");
  const treffer = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    treffer.push(source.slice(0, m.index).split("\n").length);
  }
  return treffer;
}

/** Findet ein beliebiges Muster und gibt die Zeilennummern zurück. */
export function findPattern(source, pattern) {
  const re = new RegExp(pattern.source ?? pattern, "g");
  const treffer = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    treffer.push({ zeile: source.slice(0, m.index).split("\n").length, text: m[0], gruppen: m.slice(1) });
  }
  return treffer;
}
