// tests/data.test.mjs — Kompendiumsdaten und Config gegen die Regeln prüfen
//
// Fängt die Fehlerklasse ab, die schon zweimal aufgetreten ist: ein Datenfeld,
// das syntaktisch gültig ist, aber vom Code anders gemeint war (Linderung mit
// "max": 0 heilte dadurch immer 0 HP).

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ABOREA } from "../module/config.mjs";

const root    = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const files   = readdirSync(dataDir).filter(f => f.endsWith(".json"));

/** JSON mit BOM lesen — die Dateien stammen teils aus PowerShell-Exporten. */
function readJson(file) {
  return JSON.parse(readFileSync(join(dataDir, file), "utf8").replace(/^﻿/, ""));
}

/** Alle Einträge aller Dateien, flach, mit Herkunft. */
function allEntries() {
  const out = [];
  for (const file of files) {
    const data = readJson(file);
    for (const entry of Array.isArray(data) ? data : [data]) {
      if (entry && typeof entry === "object") out.push({ file, entry });
    }
  }
  return out;
}

/** Waffen-artige Einträge, auch die in Loot-Containern verschachtelten. */
function allWeapons() {
  const out = [];
  const walk = (node, file) => {
    if (Array.isArray(node)) return node.forEach(n => walk(n, file));
    if (!node || typeof node !== "object") return;
    if (node.type === "weapon" && node.system) out.push({ file, name: node.name, system: node.system });
    for (const v of Object.values(node)) walk(v, file);
  };
  for (const file of files) walk(readJson(file), file);
  return out;
}

test("alle Datendateien sind gültiges JSON", () => {
  assert.ok(files.length > 0, "keine Datendateien gefunden");
  for (const file of files) assert.doesNotThrow(() => readJson(file), `${file} ist kein gültiges JSON`);
});

test("hpEffect ist konsistent", async t => {
  const withHp = allEntries()
    .filter(({ entry }) => entry.system?.hpEffect?.type)
    .map(({ file, entry }) => ({ file, name: entry.name, hp: entry.system.hpEffect }));

  await t.test("bekannter Typ", () => {
    for (const { file, name, hp } of withHp) {
      assert.ok(["damage", "heal", "buffDamage"].includes(hp.type),
        `${file} / ${name}: unbekannter hpEffect.type "${hp.type}"`);
    }
  });

  await t.test("max ist nie 0", () => {
    // Ein Deckel von 0 heißt "kein Effekt" und ist immer ein Datenfehler —
    // gemeint war "kein Limit", was durch Weglassen ausgedrückt wird.
    for (const { file, name, hp } of withHp) {
      assert.notEqual(hp.max, 0, `${file} / ${name}: "max": 0 bewirkt gar keinen Effekt — Feld weglassen`);
    }
  });

  await t.test("multiplier ist positiv", () => {
    for (const { file, name, hp } of withHp) {
      assert.ok(hp.multiplier === undefined || hp.multiplier > 0,
        `${file} / ${name}: multiplier ${hp.multiplier} ist nicht positiv`);
    }
  });
});

test("Waffen verweisen auf existierende Fertigkeiten und Attribute", async t => {
  const weapons = allWeapons();
  const attrKeys = Object.keys(ABOREA.attributes);

  await t.test("Fertigkeiten existieren", () => {
    for (const w of weapons) {
      for (const key of w.system.skills ?? []) {
        assert.ok(ABOREA.weaponSkillKeys.includes(key),
          `${w.file} / ${w.name}: unbekannte Waffenfertigkeit "${key}"`);
      }
    }
  });

  await t.test("attrChoices sind gültige Attribute", () => {
    for (const w of weapons) {
      for (const key of w.system.attrChoices ?? []) {
        assert.ok(attrKeys.includes(key), `${w.file} / ${w.name}: unbekanntes Attribut "${key}"`);
      }
    }
  });

  await t.test("attr liegt in attrChoices", () => {
    for (const w of weapons) {
      const choices = w.system.attrChoices ?? [];
      if (!w.system.attr || !choices.length) continue;
      assert.ok(choices.includes(w.system.attr),
        `${w.file} / ${w.name}: attr "${w.system.attr}" steht nicht in attrChoices ${JSON.stringify(choices)}`);
    }
  });

  await t.test("das Schemafeld heißt attr, nicht attribute", () => {
    // Das DataModel kennt nur attr — ein attribute-Feld wird still verworfen
    // und die beabsichtigte Attributwertung geht verloren.
    for (const w of weapons) {
      assert.equal(w.system.attribute, undefined,
        `${w.file} / ${w.name}: Feld "attribute" wird verworfen, gemeint ist "attr"`);
    }
  });

  await t.test("das alte system.skill ist überall weg", () => {
    // Auf Array system.skills umgestellt; ein Rest-String würde still ignoriert.
    for (const w of weapons) {
      assert.equal(w.system.skill, undefined,
        `${w.file} / ${w.name}: altes Feld system.skill noch vorhanden`);
    }
  });
});

test("Zauber verweisen auf existierende Spruchlisten", () => {
  for (const { file, entry } of allEntries()) {
    if (entry.type !== "spell" || !entry.system?.list) continue;
    assert.ok(ABOREA.spellListToSkillKey(entry.system.list),
      `${file} / ${entry.name}: Spruchliste "${entry.system.list}" hat keine Fertigkeit`);
  }
});

test("Fertigkeits-Config ist konsistent", async t => {
  const attrKeys = Object.keys(ABOREA.attributes);

  await t.test("jede Fertigkeit hat ein gültiges Attribut", () => {
    for (const [key, def] of Object.entries(ABOREA.skills)) {
      assert.ok(attrKeys.includes(def.attribute), `Fertigkeit "${key}": Attribut "${def.attribute}" unbekannt`);
    }
  });

  await t.test("untrained ist 0 oder −2", () => {
    for (const [key, def] of Object.entries(ABOREA.skills)) {
      if (def.untrained === undefined) continue;
      assert.equal(def.untrained, -2, `Fertigkeit "${key}": untrained ${def.untrained} ist kein gültiger Malus`);
    }
  });

  await t.test("alle Waffenfertigkeiten geben ungelernt −2", () => {
    for (const key of ABOREA.weaponSkillKeys) {
      assert.ok(ABOREA.skills[key], `weaponSkillKeys nennt "${key}", das es in skills nicht gibt`);
      assert.equal(ABOREA.skills[key].untrained, -2, `Waffenfertigkeit "${key}" ohne Ungelernt-Malus`);
    }
  });

  await t.test("Magiefertigkeiten geben keinen Ungelernt-Malus", () => {
    // Magie kann man entweder oder eben nicht — der Fall tritt nicht auf.
    for (const key of [...ABOREA.spellListSkillKeys, "gezielteSprueche", "magieEntwickeln", "magieWahrnehmen"]) {
      assert.equal(ABOREA.skills[key]?.untrained, undefined,
        `Magiefertigkeit "${key}" sollte keinen Ungelernt-Malus tragen`);
    }
  });

  await t.test("ABOREA.combatBonus ist entfernt", () => {
    // Jede signaturkompatible Variante wäre falsch: sie kann Klassenboni und
    // Befreiungen nicht kennen. Ersatz ist weaponCombatBonus().
    assert.equal(ABOREA.combatBonus, undefined,
      "ABOREA.combatBonus ist zurück — der Ungelernt-Malus würde wieder doppelt ziehen");
  });
});
