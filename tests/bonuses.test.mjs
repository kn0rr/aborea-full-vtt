// tests/bonuses.test.mjs — Fertigkeits- und Kampfboni
//
// Der Stub-Import muss zuerst stehen: ESM wertet Abhängigkeiten in
// Import-Reihenfolge aus, und die Systemmodule brauchen game/foundry.

import { character, creature, weapon, armor, item } from "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  skillBonus, weaponCombatBonus, untrainedPenalty, minStrengthPenalty,
  attributeValue, getSkillDef,
} from "../module/bonuses.mjs";

test("Attributwert kommt aus system.attributes, nicht finalAttributes", async t => {
  // finalAttributes ist ein SchemaField mit initial 5 und wird nur für
  // Charaktere geschrieben. Ein `finalAttributes ?? attributes` greift bei der
  // 5 nie und liefert für NPCs und Kreaturen konstant den falschen Wert.
  await t.test("Charakter", () => assert.equal(attributeValue(character(), "st"), 13));
  await t.test("Kreatur",   () => assert.equal(attributeValue(creature(),  "st"), 7));
  await t.test("fehlendes Attribut fällt auf 5", () =>
    assert.equal(attributeValue(character(), "xx"), 5));
});

test("Ränge von NPCs und Kreaturen liegen flach in weaponSkills/magicSkills", async t => {
  const c = creature({ weaponSkills: { aexte: 2 }, magicSkills: { gezielteSprueche: 1 } });
  await t.test("Waffenfertigkeit", () => assert.equal(getSkillDef(c, "aexte").rank, 2));
  await t.test("Magiefertigkeit",  () => assert.equal(getSkillDef(c, "gezielteSprueche").rank, 1));
  await t.test("unbekannt -> 0",   () => assert.equal(getSkillDef(c, "stichwaffe").rank, 0));
});

test("Ungelernt-Malus nach Fertigkeitskategorie", async t => {
  const a = character();
  await t.test("Waffenfertigkeit -2",  () => assert.equal(untrainedPenalty(a, "stichwaffe"), -2));
  await t.test("Wissen: Gift -2",      () => assert.equal(untrainedPenalty(a, "gift"), -2));
  await t.test("Wissen: Heilen -2",    () => assert.equal(untrainedPenalty(a, "heilen"), -2));
  await t.test("Wissen: Fallen -2",    () => assert.equal(untrainedPenalty(a, "fallen"), -2));
  await t.test("Wissen: Mechanik -2",  () => assert.equal(untrainedPenalty(a, "mechanik"), -2));
  await t.test("normal: Athletik 0",   () => assert.equal(untrainedPenalty(a, "athletik"), 0));
  await t.test("normal: Wahrnehmung 0",() => assert.equal(untrainedPenalty(a, "wahrnehmung"), 0));
  await t.test("normal: Reiten 0",     () => assert.equal(untrainedPenalty(a, "reiten"), 0));
  await t.test("Magie: Spruchliste 0", () => assert.equal(untrainedPenalty(a, "freieMagie"), 0));
  await t.test("Magie: gezielte Sprüche 0", () =>
    assert.equal(untrainedPenalty(a, "gezielteSprueche"), 0));

  await t.test("mit Rang kein Malus", () =>
    assert.equal(untrainedPenalty(character({ skills: { stichwaffe: { rank: 1 } } }), "stichwaffe"), 0));
});

test("Klassenbefreiung hebt nur den Waffenmalus auf", async t => {
  const befreit = character({ classFeatures: { bonuses: {}, weaponMinimums: { all: 1 } } });
  await t.test("Waffe befreit",       () => assert.equal(untrainedPenalty(befreit, "stichwaffe"), 0));
  await t.test("Wissen nicht befreit", () => assert.equal(untrainedPenalty(befreit, "gift"), -2));

  const bogen = character({ classFeatures: { bonuses: {}, weaponMinimums: { "bows-crossbows": 1 } } });
  await t.test("Bögen befreit",   () => assert.equal(untrainedPenalty(bogen, "boegen"), 0));
  await t.test("Armbrust befreit", () => assert.equal(untrainedPenalty(bogen, "armbrust"), 0));
  await t.test("Äxte nicht befreit", () => assert.equal(untrainedPenalty(bogen, "aexte"), -2));

  const gott = character({
    classFeatures: { bonuses: {}, weaponMinimums: { deityWeapon: 1 } },
    items: [item("god", { weaponSkills: ["wuchtwaffe"] })],
  });
  await t.test("Götterwaffe befreit",     () => assert.equal(untrainedPenalty(gott, "wuchtwaffe"), 0));
  await t.test("andere Waffe nicht",      () => assert.equal(untrainedPenalty(gott, "aexte"), -2));
});

test("Mindeststärke: −2 je zu schwerem ausgerüstetem Gegenstand", async t => {
  const schwer = { minStrength: 20 }; // über ST 13
  await t.test("ein Gegenstand", () =>
    assert.equal(minStrengthPenalty(character({ items: [weapon(schwer)] })), -2));
  await t.test("zwei stapeln", () =>
    assert.equal(minStrengthPenalty(character({ items: [weapon(schwer), armor(schwer)] })), -4));
  await t.test("nicht ausgerüstet zählt nicht", () =>
    assert.equal(minStrengthPenalty(character({ items: [item("weapon", { equipped: false, minStrength: 20 })] })), 0));
  await t.test("Anforderung erfüllt", () =>
    assert.equal(minStrengthPenalty(character({ items: [weapon({ minStrength: 10 })] })), 0));

  const mitSchwerer = character({ items: [weapon(schwer)] });
  await t.test("greift bei ST-Probe",  () => assert.equal(skillBonus(mitSchwerer, "athletik").minStrength, -2));
  await t.test("greift bei GE-Probe",  () => assert.equal(skillBonus(mitSchwerer, "reiten").minStrength, -2));
  await t.test("nicht bei IN-Probe",   () => assert.equal(skillBonus(mitSchwerer, "wissen").minStrength, 0));
  await t.test("nicht bei CH-Probe",   () => assert.equal(skillBonus(mitSchwerer, "einflussnahme").minStrength, 0));
});

test("skillBonus summiert alle Quellen", async t => {
  // GE 9 -> +2, Rang 2, Talent +1, Magiegegenstand +2, Rasse +1
  const held = character({
    skills:  { stichwaffe: { rank: 2, attribute: "ge" } },
    talents: [{ skillBonuses: { stichwaffe: 1 } }],
    items: [
      item("race",  { traits: { skillBonuses: { stichwaffe: 1 } } }),
      item("magic", { equipped: true, skillBonuses: { stichwaffe: 2 } }),
    ],
  });
  const b = skillBonus(held, "stichwaffe");
  await t.test("Summe",          () => assert.equal(b.total, 8));
  await t.test("Attribut aus der Fertigkeit", () => assert.equal(b.attrKey, "ge"));
  await t.test("Aufschlüsselung vollständig", () =>
    assert.equal(b.breakdown.reduce((s, p) => s + p.value, 0), b.total));

  await t.test("nicht ausgerüsteter Magiegegenstand zählt nicht", () => {
    const ohne = character({
      skills: { stichwaffe: { rank: 2 } },
      items:  [item("magic", { equipped: false, skillBonuses: { stichwaffe: 2 } })],
    });
    assert.equal(skillBonus(ohne, "stichwaffe").classBonus, 0);
  });

  await t.test("Attribut übersteuerbar (Waffen mit attrChoices)", () =>
    assert.equal(skillBonus(held, "stichwaffe", { attrKey: "st" }).attrBonus, 4));

  await t.test("attributes-Override für den Recalc", () =>
    assert.equal(skillBonus(held, "stichwaffe", { attributes: { ge: { value: 15 } } }).attrBonus, 5));
});

test("Eigene Fertigkeiten tragen ihre Kategorie selbst", async t => {
  const mit = (untrained, rank = 0) => character({
    customSkills: [{ key: "c1", name: "Wissen (Heraldik)", attribute: "in", rank, cost: "1", untrained }],
  });
  await t.test("Kategorie normal", () => assert.equal(untrainedPenalty(mit(0), "c1"), 0));
  await t.test("Kategorie Wissen", () => assert.equal(untrainedPenalty(mit(-2), "c1"), -2));
  await t.test("mit Rang kein Malus", () => assert.equal(untrainedPenalty(mit(-2, 2), "c1"), 0));
  await t.test("Label aus dem Namen", () =>
    assert.equal(skillBonus(mit(0), "c1").label, "Wissen (Heraldik)"));
});

test("weaponCombatBonus", async t => {
  const dolch = weapon({ skills: ["stichwaffe"], damage: -1 });

  await t.test("ungelernt: genau −2, nicht doppelt", () => {
    // GE 9 -> +2, Rang 0, ungelernt −2 = 0. Vorher zog ABOREA.combatBonus den
    // Malus ein und _executeAttack ein zweites Mal -> −2.
    assert.equal(weaponCombatBonus(character({ items: [dolch] }), { weapon: dolch }).total, 0);
  });

  await t.test("Klassenbefreiung wirkt", () => {
    const befreit = character({ items: [dolch], classFeatures: { bonuses: {}, weaponMinimums: { all: 1 } } });
    assert.equal(weaponCombatBonus(befreit, { weapon: dolch }).total, 2);
  });

  await t.test("Talent, Magiegegenstand und Rasse fließen ein", () => {
    const held = character({
      skills:  { stichwaffe: { rank: 2 } },
      talents: [{ skillBonuses: { stichwaffe: 1 } }],
      items: [dolch,
              item("race",  { traits: { skillBonuses: { stichwaffe: 1 } } }),
              item("magic", { equipped: true, skillBonuses: { stichwaffe: 2 } })],
    });
    assert.equal(weaponCombatBonus(held, { weapon: dolch }).total, 8);
  });

  await t.test("Waffen-Attribut übersteuert die Fertigkeit", () => {
    const kurzschwert = weapon({ skills: ["kurzeKlingenwaffe", "stichwaffe"], attr: "st" });
    const held = character({ items: [kurzschwert], skills: { stichwaffe: { rank: 1 } } });
    assert.equal(weaponCombatBonus(held, { weapon: kurzschwert }).total, 4 + 1); // ST 13 statt GE 9
  });

  await t.test("bester Wert über mehrere Fertigkeiten", () => {
    const w = weapon({ skills: ["kurzeKlingenwaffe", "stichwaffe"] });
    const held = character({ items: [w], skills: { kurzeKlingenwaffe: { rank: 1 }, stichwaffe: { rank: 3 } } });
    assert.equal(weaponCombatBonus(held, { weapon: w }).total, 2 + 3);
  });

  await t.test("Mindeststärke steckt NICHT im Kampfbonus", () => {
    // Sie wirkt laut Regel auf den Angriff — im Pool würde sie auch die
    // defensive Hälfte der Aufteilung drücken.
    const schwer = weapon({ skills: ["wuchtwaffe"], minStrength: 20 });
    const held   = character({ items: [schwer], skills: { wuchtwaffe: { rank: 2 } } });
    assert.equal(weaponCombatBonus(held, { weapon: schwer }).total, 4 + 2);
    assert.equal(minStrengthPenalty(held), -2);
  });

  await t.test("trainedOnly überspringt ungelernte Fertigkeiten", () => {
    const npc = creature({ weaponSkills: { aexte: 0, wuchtwaffe: 2 } });
    assert.equal(weaponCombatBonus(npc, { skillKeys: ["aexte", "wuchtwaffe"], trainedOnly: true }).skillKey, "wuchtwaffe");
  });

  await t.test("ohne ausgebildete Fertigkeit null", () => {
    const npc = creature({ weaponSkills: {} });
    assert.equal(weaponCombatBonus(npc, { skillKeys: ["aexte"], trainedOnly: true }), null);
  });
});
