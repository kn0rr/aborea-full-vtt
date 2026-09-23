// tests/combat.test.mjs — Verteidigungswert und Zauberschaden
//
// Stub zuerst: combat.mjs greift beim Laden auf foundry.applications.api und
// die globale Combat-Klasse zu.

import { character, creature, armor, weapon } from "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { actorDefenseValue, spellDamage, maneuverBonus, bonusWeaponDamage, hpColor, roundSplitOf,
         pickCombatId } from "../module/combat.mjs";
import { ABOREA } from "../module/config.mjs";
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

test("Initiative ist ein fester Wert, kein Wurf", async t => {
  // GE-Bonus + bester Initiative-Mod der ausgerüsteten Waffen. Bei Gleichstand
  // wird im Tracker manuell ein W10 nachgeworfen.
  const init = (attrs, items = []) => ABOREA.initiativeBonus({ system: { attributes: attrs }, items });
  const ge = v => ({ ge: { value: v } });

  await t.test("nur GE, keine Waffe", () => assert.equal(init(ge(9)), 2));
  await t.test("GE 5 ist neutral",     () => assert.equal(init(ge(5)), 0));
  await t.test("negativer GE-Bonus",   () => assert.equal(init(ge(2)), -2));

  await t.test("Waffen-Initiative kommt dazu", () =>
    assert.equal(init(ge(9), [weapon({ initiative: 2 })]), 4));

  await t.test("beste ausgerüstete Waffe zählt", () =>
    assert.equal(init(ge(9), [weapon({ initiative: 1 }), weapon({ initiative: 3 })]), 5));

  await t.test("nicht ausgerüstete Waffen zählen nicht", () =>
    assert.equal(init(ge(9), [{ type: "weapon", system: { equipped: false, initiative: 9 } }]), 2));

  await t.test("negative Waffen-Initiative drückt", () =>
    assert.equal(init(ge(9), [weapon({ initiative: -2 })]), 0));

  await t.test("ohne Actor kein Absturz", () => assert.equal(ABOREA.initiativeBonus(null), 0));

  await t.test("Kreatur: Attribut kommt aus attributes", () =>
    assert.equal(ABOREA.initiativeBonus(creature({ attributes: { ge: { value: 11 } } })), 3));
});

test("HP-Farbe für Balken und Zielvorschau", async t => {
  await t.test("gesund grün",   () => assert.equal(hpColor(100), "#2d8a3e"));
  await t.test("knapp über 60",  () => assert.equal(hpColor(61), "#2d8a3e"));
  await t.test("60 ist gelb",    () => assert.equal(hpColor(60), "#c08a00"));
  await t.test("26 ist gelb",    () => assert.equal(hpColor(26), "#c08a00"));
  await t.test("25 ist rot",     () => assert.equal(hpColor(25), "#b91c1c"));
  await t.test("0 ist rot",      () => assert.equal(hpColor(0), "#b91c1c"));
});

test("Verteidigungswert folgt der Rundenerklaerung", async t => {
  // Der Kampfbonus ist eine Ressource pro Runde: wer Zaubern erklaert, hat
  // keinen Defensivbonus - und zwar ab der Erklaerung, nicht erst nach dem
  // Zauber.
  const held = (decl, system = {}) => ({
    type: "character", items: [], flags: decl ? { "aborea-v7": { declaration: decl } } : {},
    system: {
      combat: { armorValue: 5, combatBonus: 6, offensiveBonus: 4, defensiveBonus: 2 },
      ...system,
    },
  });
  const inRunde = n => { globalThis.game.combat = n == null ? undefined : { round: n }; };

  await t.test("ohne Erklaerung gilt die Aufteilung vom Bogen", () => {
    inRunde(3);
    assert.equal(actorDefenseValue(held(null)), 5 + 2);
  });

  await t.test("Waffe 4/2 erklaert", () => {
    inRunde(3);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "weapon", offensive: 4 })), 5 + 2);
  });

  await t.test("alles offensiv erklaert: kein Schutz", () => {
    inRunde(3);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "weapon", offensive: 6 })), 5);
  });

  await t.test("alles defensiv erklaert", () => {
    inRunde(3);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "weapon", offensive: 0 })), 5 + 6);
  });

  await t.test("Zauber erklaert: kein Defensivbonus", () => {
    inRunde(3);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "spell" })), 5);
  });

  await t.test("die Erklaerung verfaellt mit der Runde", () => {
    inRunde(4);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "spell" })), 5 + 2);
  });

  await t.test("ohne Kampf gilt die Vorbelegung", () => {
    inRunde(null);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "spell" })), 5 + 2);
  });

  await t.test("Ruestung und Manoeverbonus bleiben unberuehrt", () => {
    inRunde(3);
    assert.equal(actorDefenseValue(held({ round: 3, mode: "spell" }, { traits: { maneuverBonus: 2 } })), 5 + 2);
  });

  await t.test("roundSplitOf liefert die Aufteilung der laufenden Runde", () => {
    inRunde(3);
    const s = roundSplitOf(held({ round: 3, mode: "weapon", offensive: 5 }));
    assert.equal(s.offensive, 5);
    assert.equal(s.defensive, 1);
    assert.equal(s.declared, true);
  });

  inRunde(null);
});

test("pickCombatId: welcher Kampf gilt", async t => {
  // game.combat ist nicht "der laufende Kampf", sondern der, den der
  // Kampfbericht anzeigt. Und der wird nur beim *Rendern* gesetzt: ein
  // Seitenleisten-Reiter, den der Spielleiter einmal verlassen hat, steht in
  // ApplicationV2 auf CLOSED, und dort steigt render() ohne force aus, bevor
  // viewed gesetzt wird —
  //
  //     options.isFirstRender = this.#state <= states.NONE;
  //     if ( options.isFirstRender && !options.force ) return this;
  //
  // Danach war game.combat null, obwohl der Kampf lief: das Kampfpult zeigte
  // nur noch die Auswahlliste, und declareRound() lehnte jede Erklaerung ab,
  // auch die Flucht. Deshalb dieselbe Herleitung wie im Kampfbericht.
  const k = (id, over = {}) => ({ id, sceneId: over.sceneId ?? "s1", active: over.active ?? false });

  await t.test("was der Bericht zeigt, gilt", () =>
    assert.equal(pickCombatId({ viewedId: "k9", combats: [k("k1")], sceneId: "s1" }), "k9"));

  await t.test("zeigt er nichts, gilt der aktivierte", () =>
    assert.equal(pickCombatId({
      combats: [k("k1"), k("k2", { active: true })], sceneId: "s1" }), "k2"));

  await t.test("sonst einer der betrachteten Szene", () =>
    assert.equal(pickCombatId({
      combats: [k("k1", { sceneId: "s2" }), k("k2", { sceneId: "s1" })], sceneId: "s1" }), "k2"));

  await t.test("ein aktivierter auf fremder Szene zaehlt nicht", () =>
    // Combat#isActive prueft scene.isView — ein aktivierter Kampf woanders
    // ist hier nicht der laufende.
    assert.equal(pickCombatId({
      combats: [k("k1", { sceneId: "s2", active: true }), k("k2", { sceneId: "s1" })],
      sceneId: "s1" }), "k2"));

  await t.test("ein Kampf ohne Szene zaehlt ueberall", () =>
    assert.equal(pickCombatId({ combats: [k("k1", { sceneId: "" })], sceneId: "s9" }), "k1"));

  await t.test("nur Kaempfe fremder Szenen: keiner", () =>
    assert.equal(pickCombatId({ combats: [k("k1", { sceneId: "s2" })], sceneId: "s1" }), ""));

  await t.test("der erste passende gewinnt", () =>
    assert.equal(pickCombatId({ combats: [k("k1"), k("k2")], sceneId: "s1" }), "k1"));

  await t.test("Kaempfe ohne Kennung fallen raus", () =>
    assert.equal(pickCombatId({ combats: [{ sceneId: "s1" }, null, k("k1")], sceneId: "s1" }), "k1"));

  await t.test("leere Eingabe", () => {
    assert.equal(pickCombatId({ combats: [], sceneId: "s1" }), "");
    assert.equal(pickCombatId({}), "");
    assert.equal(pickCombatId(), "");
  });
});
