// tests/combat.test.mjs — Verteidigungswert und Zauberschaden
//
// Stub zuerst: combat.mjs greift beim Laden auf foundry.applications.api und
// die globale Combat-Klasse zu.

import { character, creature, armor, weapon } from "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { actorDefenseValue, spellDamage, maneuverBonus, bonusWeaponDamage } from "../module/combat.mjs";
import { inferDirectHp } from "../module/actor-helpers.mjs";

test("Verteidigungswert", async t => {
  const dv = (system, items = []) => actorDefenseValue({ type: "character", items, system });

  await t.test("Grundwert",            () => assert.equal(dv({ combat: { armorValue: 5 } }), 5));
  await t.test("getragene Rüstung",    () => assert.equal(dv({ combat: { armorValue: 5 } }, [armor({ armor: 3 })]), 8));
  await t.test("Defensivbonus",        () => assert.equal(dv({ combat: { armorValue: 5, defensiveBonus: 3 } }), 8));

  // Diese drei fielen vorher heraus: der Charakterzweig las
  // system.combat.totalArmorValue, das nur auf dem Sheet-Klon existiert.
  await t.test("Rassen-Rüstungsbonus", () =>
    assert.equal(dv({ combat: { armorValue: 5 }, traits: { racialArmorBonus: 2 } }), 7));
  await t.test("Klassen-Rüstungsbonus", () =>
    assert.equal(dv({ combat: { armorValue: 5 }, classFeatures: { armorBonus: 1 } }), 6));
  await t.test("Manöverbonus aus Zaubereffekten", () =>
    assert.equal(dv({ combat: { armorValue: 5 }, traits: { maneuverBonus: 2 } }), 7));

  await t.test("alles zusammen", () =>
    assert.equal(dv({
      combat: { armorValue: 5, defensiveBonus: 3 },
      traits: { racialArmorBonus: 2, maneuverBonus: 1 },
      classFeatures: { armorBonus: 1 },
    }, [armor({ armor: 4 })]), 5 + 2 + 1 + 4 + 3 + 1));

  await t.test("nicht getragene Rüstung zählt nicht", () =>
    assert.equal(dv({ combat: { armorValue: 5 } }, [{ type: "armor", system: { equipped: false, armor: 9 } }]), 5));

  await t.test("ohne Actor Fallback 5", () => assert.equal(actorDefenseValue(null), 5));
});

test("Active-Effect-Werte werden im Kampf gelesen", async t => {
  await t.test("Manöverbonus", () =>
    assert.equal(maneuverBonus(character({ traits: { maneuverBonus: 3 } })), 3));
  await t.test("Manöverbonus fehlt -> 0", () =>
    assert.equal(maneuverBonus(character()), 0));
  // Flammenschwert setzte diesen Flag, gelesen hat ihn vorher niemand.
  await t.test("Waffenschaden aus Zauber", () =>
    assert.equal(bonusWeaponDamage(character({ flags: { aborea: { extraWeaponDamage: 4 } } })), 4));
  await t.test("kein Flag -> 0", () =>
    assert.equal(bonusWeaponDamage(character()), 0));
});

test("Zauberschaden: Angriffswert − Verteidigungswert + MP-Schaden", async t => {
  const blitz     = { system: { hpEffect: { type: "damage", multiplier: 1 } } };
  const feuerball = { system: { hpEffect: { type: "damage", multiplier: 1, max: 5 } } };
  const linderung = { system: { hpEffect: { type: "heal", multiplier: 1 } } };

  await t.test("Blitz 5 MP, AW 10 gegen RW 6 macht 9", () => {
    const d = spellDamage(inferDirectHp(blitz, 5), 10, 6, false);
    assert.equal(d.total, 9);
    assert.equal(d.overshoot, 4);
    assert.equal(d.mpDamage, 5);
  });

  await t.test("knapper Treffer", () =>
    assert.equal(spellDamage(inferDirectHp(blitz, 5), 7, 6, false).total, 6));

  await t.test("Krit verdoppelt den MP-Anteil", () =>
    assert.equal(spellDamage(inferDirectHp(blitz, 5), 10, 6, true).total, 4 + 5 + 5));

  await t.test("max deckelt nur den MP-Anteil, nicht den Überschuss", () => {
    assert.equal(inferDirectHp(feuerball, 12).amount, 5);
    assert.equal(spellDamage(inferDirectHp(feuerball, 12), 14, 6, false).total, 8 + 5);
  });

  await t.test("Heilung ist kein Schaden", () =>
    assert.equal(spellDamage(inferDirectHp(linderung, 5), 10, 6, false), null));

  await t.test("Zauber ohne hpEffect", () =>
    assert.equal(spellDamage(inferDirectHp({ system: {} }, 5), 10, 6, false), null));

  await t.test("Mindestschaden 1", () =>
    assert.equal(spellDamage({ type: "damage", amount: 0 }, 7, 6, false).total, 1));
});

test("inferDirectHp: max 0 ist kein Deckel", async t => {
  // Linderung trug "max": 0 und heilte dadurch immer 0 HP. Charaktere halten
  // eigene Item-Kopien, die ein Kompendium-Re-Import nicht anfasst.
  const kaputt = { system: { hpEffect: { type: "heal", multiplier: 1, max: 0 } } };
  await t.test("max 0 wird ignoriert", () => assert.equal(inferDirectHp(kaputt, 5).amount, 5));
  await t.test("max > 0 deckelt",      () =>
    assert.equal(inferDirectHp({ system: { hpEffect: { type: "heal", multiplier: 1, max: 3 } } }, 5).amount, 3));
});
