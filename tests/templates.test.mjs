// tests/templates.test.mjs — Blockstruktur der Handlebars-Vorlagen
//
// Vorlagen lädt Foundry, nicht Node — sie standen deshalb ausserhalb jeder
// Prüfung. Ein falsch geschlossener Block bringt dort das ganze Fenster zu
// Fall, ohne dass hier etwas davon bemerkt würde.
//
// Geprüft wird die Struktur, nicht die Ausgabe: jeder Block wird mit
// demselben Helfer geschlossen, mit dem er geöffnet wurde, und kein {{else}}
// steht ausserhalb eines Blocks.
//
// Was das *nicht* findet: ein {{else}}, das am falschen der ineinander
// geschachtelten Blöcke hängt. Genau das stand im Kampfpult — ein
// ausgeschiedener Kombattant zeigte "flieht" an, ein fliehender gar nichts —
// und war dabei vollkommen ausgeglichen. Gegen diese Klasse hilft keine
// Strukturprüfung, sondern nur, die Entscheidung aus der Vorlage
// herauszunehmen: die Zeilen des Pults entstehen jetzt in
// buildConsoleRows() und sind dort geprüft.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_DIR = new URL("../templates/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function allTemplates(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allTemplates(full, found);
    else if (entry.endsWith(".html") || entry.endsWith(".hbs")) found.push(full);
  }
  return found;
}

/**
 * Zerlegt eine Vorlage in ihre Blockmarken.
 *
 * Kommentare fallen weg, sonst würde ein auskommentiertes {{/if}} mitzählen.
 * Innerhalb der Marken kommen keine geschweiften Klammern vor — auch nicht in
 * Unterausdrücken wie (aboreaEq mode "weapon") —, deshalb reicht die Suche
 * bis zum nächsten "}}".
 */
export function blockMarks(source) {
  const ohneKommentare = source.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![^}]*\}\}/g, "");
  const marks = [];
  const re = /\{\{([#/^])?\s*(else\s+\w+|[\w./-]+)?[^}]*\}\}/g;
  let m;
  while ((m = re.exec(ohneKommentare)) !== null) {
    const [raw, sigil, name = ""] = m;
    const zeile = ohneKommentare.slice(0, m.index).split("\n").length;
    if (sigil === "#")                    marks.push({ kind: "open",  name, zeile, raw });
    else if (sigil === "/")               marks.push({ kind: "close", name, zeile, raw });
    else if (sigil === "^")               marks.push({ kind: name ? "open" : "else", name, zeile, raw });
    else if (name.startsWith("else"))     marks.push({ kind: "else",  name, zeile, raw });
  }
  return marks;
}

/** Findet Strukturfehler; leere Liste heisst: in Ordnung. */
export function blockErrors(source) {
  const stack = [];
  const fehler = [];
  for (const mark of blockMarks(source)) {
    if (mark.kind === "open") stack.push(mark);
    else if (mark.kind === "else") {
      if (!stack.length) fehler.push(`Zeile ${mark.zeile}: ${mark.raw} ausserhalb eines Blocks`);
    } else {
      const offen = stack.pop();
      if (!offen) fehler.push(`Zeile ${mark.zeile}: ${mark.raw} ohne offenen Block`);
      else if (offen.name !== mark.name) {
        fehler.push(`Zeile ${mark.zeile}: ${mark.raw} schliesst {{#${offen.name}}} aus Zeile ${offen.zeile}`);
      }
    }
  }
  for (const offen of stack) fehler.push(`Zeile ${offen.zeile}: {{#${offen.name}}} wird nie geschlossen`);
  return fehler;
}

test("blockErrors erkennt, was es erkennen soll", async t => {
  await t.test("saubere Vorlage", () =>
    assert.deepEqual(blockErrors("{{#if a}}x{{else}}y{{/if}}"), []));

  await t.test("nicht geschlossen", () =>
    assert.equal(blockErrors("{{#if a}}x").length, 1));

  await t.test("falscher Helfer beim Schliessen", () => {
    const f = blockErrors("{{#each rows}}x{{/if}}");
    assert.equal(f.length, 1);
    assert.match(f[0], /schliesst/);
  });

  await t.test("ohne offenen Block geschlossen", () =>
    assert.equal(blockErrors("x{{/if}}").length, 1));

  await t.test("{{else}} ausserhalb eines Blocks", () =>
    assert.equal(blockErrors("{{else}}").length, 1));

  await t.test("verschachtelt und verdreht", () => {
    const f = blockErrors("{{#if a}}{{#each b}}{{/if}}{{/each}}");
    assert.ok(f.length >= 1);
  });

  await t.test("{{else if}} zaehlt nicht als eigener Block", () =>
    assert.deepEqual(blockErrors("{{#if a}}1{{else if b}}2{{else}}3{{/if}}"), []));

  await t.test("Unterausdruecke stoeren nicht", () =>
    assert.deepEqual(blockErrors('{{#if (aboreaEq mode "weapon")}}x{{/if}}'), []));

  await t.test("auskommentierte Marken zaehlen nicht", () =>
    assert.deepEqual(blockErrors("{{#if a}}x{{!-- {{/if}} --}}{{/if}}"), []));

  await t.test("leere Vorlage", () => assert.deepEqual(blockErrors(""), []));
});

test("alle Vorlagen sind sauber verschachtelt", async t => {
  const dateien = allTemplates(TEMPLATE_DIR);
  assert.ok(dateien.length > 0, "keine Vorlagen gefunden");

  for (const datei of dateien) {
    const kurz = datei.split(/[\\/]templates[\\/]/).pop();
    await t.test(kurz, () => {
      const fehler = blockErrors(readFileSync(datei, "utf8"));
      assert.deepEqual(fehler, [], `${kurz}:\n  ${fehler.join("\n  ")}`);
    });
  }
});
