// tests/declaration.test.mjs — Rundenerklärung
//
// Der Kampfbonus ist eine Ressource pro Runde. Vorher war die Aufteilung eine
// stehende Zahl auf dem Bogen; jetzt ein Beschluss, der mit der Runde verfällt.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  declarationFor, roundSplit, buildDeclaration, splitLabel, canRedeclare,
  splitRange, clampOffensive,
} from "../module/declaration.mjs";

/** Actor mit Kampfbonus-Pool und optionaler Erklärung. */
const kaempfer = ({ pool = 6, offensiv = 4, defensiv = 2, decl = null } = {}) => ({
  type: "character",
  flags: decl ? { "aborea-v7": { declaration: decl } } : {},
  system: { combat: { combatBonus: pool, offensiveBonus: offensiv, defensiveBonus: defensiv } },
});

test("declarationFor gilt nur für die laufende Runde", async t => {
  const a = kaempfer({ decl: { round: 3, mode: "weapon", offensive: 5 } });

  await t.test("passende Runde", () => assert.equal(declarationFor(a, 3).offensive, 5));
  await t.test("andere Runde verfällt", () => assert.equal(declarationFor(a, 4), null));
  await t.test("ohne laufenden Kampf", () => assert.equal(declarationFor(a, undefined), null));
  await t.test("ohne Erklärung", () => assert.equal(declarationFor(kaempfer(), 3), null));
});

test("roundSplit ohne Erklärung: Vorbelegung vom Bogen", async t => {
  const split = roundSplit(kaempfer({ pool: 6, offensiv: 4, defensiv: 2 }), 3);

  await t.test("als nicht erklärt markiert", () => assert.equal(split.declared, false));
  await t.test("offensiv vom Bogen", () => assert.equal(split.offensive, 4));
  await t.test("defensiv vom Bogen", () => assert.equal(split.defensive, 2));
  await t.test("nicht festgesetzt", () => assert.equal(split.locked, false));

  await t.test("abweichende gespeicherte Werte bleiben unangetastet", () => {
    // NPCs pflegen die drei Zahlen von Hand; sie müssen nicht aufgehen.
    // Ohne Erklärung darf sich daran nichts ändern.
    const s = roundSplit(kaempfer({ pool: 6, offensiv: 9, defensiv: 7 }), 3);
    assert.equal(s.offensive, 9);
    assert.equal(s.defensive, 7);
  });
});

test("roundSplit mit Waffenerklärung", async t => {
  const split = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "weapon", offensive: 4 } }), 3);

  await t.test("erklärt", () => assert.equal(split.declared, true));
  await t.test("offensiv wie erklärt", () => assert.equal(split.offensive, 4));
  await t.test("defensiv ist der Rest des Pools", () => assert.equal(split.defensive, 2));

  await t.test("alles offensiv lässt nichts übrig", () => {
    const s = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "weapon", offensive: 6 } }), 3);
    assert.equal(s.defensive, 0);
  });
  await t.test("alles defensiv", () => {
    const s = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "weapon", offensive: 0 } }), 3);
    assert.equal(s.defensive, 6);
  });
  await t.test("über dem Pool wird geklemmt", () => {
    const s = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "weapon", offensive: 99 } }), 3);
    assert.equal(s.offensive, 6);
    assert.equal(s.defensive, 0);
  });
  await t.test("negativ wird geklemmt", () => {
    const s = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "weapon", offensive: -5 } }), 3);
    assert.equal(s.offensive, 0);
    assert.equal(s.defensive, 6);
  });
});

test("roundSplit mit Zaubererklärung", async t => {
  const split = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "spell" } }), 3);

  await t.test("voller Pool offensiv", () => assert.equal(split.offensive, 6));
  await t.test("kein Defensivbonus", () => assert.equal(split.defensive, 0));
  await t.test("ein angegebener Offensivwert wird ignoriert", () => {
    const s = roundSplit(kaempfer({ pool: 6, decl: { round: 3, mode: "spell", offensive: 2 } }), 3);
    assert.equal(s.defensive, 0);
  });
  await t.test("nächste Runde gilt wieder die Vorbelegung", () =>
    assert.equal(roundSplit(kaempfer({ pool: 6, defensiv: 2, decl: { round: 3, mode: "spell" } }), 4).defensive, 2));
});

test("buildDeclaration", async t => {
  await t.test("Waffe klemmt auf den Pool", () =>
    assert.deepEqual(buildDeclaration(2, { mode: "weapon", offensive: 9, pool: 6 }),
      { round: 2, mode: "weapon", offensive: 6, locked: false }));
  await t.test("Zauber nimmt den vollen Pool", () =>
    assert.deepEqual(buildDeclaration(2, { mode: "spell", offensive: 1, pool: 6 }),
      { round: 2, mode: "spell", offensive: 6, locked: false }));
  await t.test("unbekannter Modus gilt als Waffe", () =>
    assert.equal(buildDeclaration(2, { mode: "unsinn", offensive: 3, pool: 6 }).mode, "weapon"));
  await t.test("lock wird übernommen", () =>
    assert.equal(buildDeclaration(2, { mode: "weapon", pool: 6, locked: true }).locked, true));
});

test("canRedeclare: bis zur ersten Handlung", async t => {
  await t.test("ohne Erklärung frei", () =>
    assert.equal(canRedeclare(kaempfer(), 3), true));
  await t.test("erklärt, aber noch nicht gehandelt", () =>
    assert.equal(canRedeclare(kaempfer({ decl: { round: 3, mode: "weapon", offensive: 4 } }), 3), true));
  await t.test("nach der Handlung festgesetzt", () =>
    assert.equal(canRedeclare(kaempfer({ decl: { round: 3, mode: "weapon", offensive: 4, locked: true } }), 3), false));
  await t.test("in der nächsten Runde wieder frei", () =>
    assert.equal(canRedeclare(kaempfer({ decl: { round: 3, mode: "weapon", locked: true } }), 4), true));
});

test("splitLabel für den Tracker", async t => {
  await t.test("Waffe zeigt die Aufteilung", () =>
    assert.equal(splitLabel({ mode: "weapon", offensive: 4, defensive: 2 }), "⚔4 / 🛡2"));
  await t.test("Zauber zeigt den Modus", () =>
    assert.equal(splitLabel({ mode: "spell", offensive: 6, defensive: 0 }), "✨ Zauber"));
});

test("negativer Kampfbonus laesst sich verschieben", async t => {
  // Ein negativer Kampfbonus ist ein Malus. Er wird nicht auf [0, Bonus]
  // geklemmt, sonst waere jede Verteilung unmoeglich: Math.max(0, Math.min(-1, x))
  // ergibt immer 0.
  const mit = (pool, offensiv) => roundSplit({
    type: "character",
    flags: { "aborea-v7": { declaration: { round: 3, mode: "weapon", offensive: offensiv } } },
    system: { combat: { combatBonus: pool } },
  }, 3);

  await t.test("Kampfbonus -1, offensiv -2 gibt defensiv +1", () => {
    const s = mit(-1, -2);
    assert.equal(s.offensive, -2);
    assert.equal(s.defensive, 1);
  });
  await t.test("Kampfbonus -1, offensiv -1 gibt defensiv 0", () => {
    const s = mit(-1, -1);
    assert.equal(s.defensive, 0);
  });
  await t.test("Kampfbonus -1, offensiv 0 gibt defensiv -1", () => {
    const s = mit(-1, 0);
    assert.equal(s.defensive, -1);
  });
  await t.test("die Summe bleibt immer der Kampfbonus", () => {
    for (const pool of [-4, -2, -1, 0, 1, 3, 6]) {
      for (let off = -10; off <= 10; off++) {
        const s = mit(pool, off);
        assert.equal(s.offensive + s.defensive, pool,
          `Pool ${pool}, offensiv ${off}: Summe stimmt nicht`);
      }
    }
  });
});

test("splitRange: erlaubter Bereich des Offensivanteils", async t => {
  await t.test("positiver Bonus: 0 bis voller Wert", () =>
    assert.deepEqual(splitRange(6), { min: 0, max: 6 }));
  await t.test("negativer Bonus: doppelter Wert bis 0", () =>
    assert.deepEqual(splitRange(-1), { min: -2, max: 0 }));
  await t.test("Kampfbonus -3", () =>
    assert.deepEqual(splitRange(-3), { min: -6, max: 0 }));
  await t.test("Kampfbonus 0 laesst nichts zu verteilen", () =>
    assert.deepEqual(splitRange(0), { min: 0, max: 0 }));
  await t.test("unbrauchbarer Wert wie 0", () =>
    assert.deepEqual(splitRange(undefined), { min: 0, max: 0 }));
});

test("clampOffensive", async t => {
  await t.test("im Bereich unveraendert", () => assert.equal(clampOffensive(4, 6), 4));
  await t.test("ueber dem Bonus geklemmt", () => assert.equal(clampOffensive(9, 6), 6));
  await t.test("unter 0 bei positivem Bonus geklemmt", () => assert.equal(clampOffensive(-5, 6), 0));
  await t.test("negativer Bonus laesst negative Werte zu", () => assert.equal(clampOffensive(-2, -1), -2));
  await t.test("negativer Bonus klemmt beim doppelten", () => assert.equal(clampOffensive(-9, -1), -2));
  await t.test("negativer Bonus klemmt nach oben bei 0", () => assert.equal(clampOffensive(3, -1), 0));
});

test("buildDeclaration mit negativem Kampfbonus", async t => {
  await t.test("erlaubt die Verschiebung", () =>
    assert.equal(buildDeclaration(3, { mode: "weapon", offensive: -2, pool: -1 }).offensive, -2));
  await t.test("klemmt jenseits des Bereichs", () =>
    assert.equal(buildDeclaration(3, { mode: "weapon", offensive: -99, pool: -1 }).offensive, -2));
});
