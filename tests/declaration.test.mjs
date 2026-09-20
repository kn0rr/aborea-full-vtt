// tests/declaration.test.mjs — Rundenerklärung
//
// Der Kampfbonus ist eine Ressource pro Runde. Vorher war die Aufteilung eine
// stehende Zahl auf dem Bogen; jetzt ein Beschluss, der mit der Runde verfällt.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  declarationFor, roundSplit, buildDeclaration, splitLabel, canRedeclare,
  splitRange, clampOffensive, carrySplit,
  defenseSpentTotal, defenseRemaining, spendDefense, defenseAgainst,
  fleeDefenseBonus, isFleeing,
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

test("negativer Kampfbonus geht vollstaendig in die Offensive", async t => {
  // Regelwerk S. 33: "Ein negativer Kampfbonus wirkt sich nicht auf den DB
  // aus, sondern ist vollstaendig dem OB zuzurechnen." Er laesst sich also
  // nicht verteilen, und der Defensivbonus wird nie negativ.
  const mit = (pool, offensiv) => roundSplit({
    type: "character",
    flags: { "aborea-v7": { declaration: { round: 3, mode: "weapon", offensive: offensiv } } },
    system: { combat: { combatBonus: pool } },
  }, 3);

  await t.test("Kampfbonus -1 gibt offensiv -1, defensiv 0", () => {
    const s = mit(-1, -1);
    assert.equal(s.offensive, -1);
    assert.equal(s.defensive, 0);
  });
  await t.test("eine Verschiebung auf -2 ist nicht moeglich", () => {
    const s = mit(-1, -2);
    assert.equal(s.offensive, -1);
    assert.equal(s.defensive, 0);
  });
  await t.test("offensiv 0 ist ebenfalls nicht moeglich", () => {
    // Sonst waere der Defensivbonus -1, und ein negativer KB soll den DB
    // gerade nicht beruehren.
    const s = mit(-1, 0);
    assert.equal(s.offensive, -1);
    assert.equal(s.defensive, 0);
  });
  await t.test("Kampfbonus -3", () => {
    const s = mit(-3, 0);
    assert.equal(s.offensive, -3);
    assert.equal(s.defensive, 0);
  });

  await t.test("der Defensivbonus wird nie negativ", () => {
    for (const pool of [-6, -3, -1, 0, 1, 4, 6]) {
      for (let off = -10; off <= 10; off++) {
        const s = mit(pool, off);
        assert.ok(s.defensive >= 0, `Pool ${pool}, offensiv ${off}: defensiv ${s.defensive} ist negativ`);
        assert.equal(s.offensive + s.defensive, pool, `Pool ${pool}: Summe stimmt nicht`);
      }
    }
  });
});

test("splitRange: erlaubter Bereich des Offensivanteils", async t => {
  await t.test("positiver Bonus: 0 bis voller Wert", () =>
    assert.deepEqual(splitRange(6), { min: 0, max: 6 }));
  await t.test("negativer Bonus laesst keine Wahl", () =>
    assert.deepEqual(splitRange(-1), { min: -1, max: -1 }));
  await t.test("Kampfbonus -3 ebenso", () =>
    assert.deepEqual(splitRange(-3), { min: -3, max: -3 }));
  await t.test("Kampfbonus 0 laesst nichts zu verteilen", () =>
    assert.deepEqual(splitRange(0), { min: 0, max: 0 }));
  await t.test("unbrauchbarer Wert wie 0", () =>
    assert.deepEqual(splitRange(undefined), { min: 0, max: 0 }));
});

test("clampOffensive", async t => {
  await t.test("im Bereich unveraendert", () => assert.equal(clampOffensive(4, 6), 4));
  await t.test("ueber dem Bonus geklemmt", () => assert.equal(clampOffensive(9, 6), 6));
  await t.test("unter 0 bei positivem Bonus geklemmt", () => assert.equal(clampOffensive(-5, 6), 0));
  await t.test("negativer Bonus geht immer vollstaendig offensiv", () => {
    assert.equal(clampOffensive(-2, -1), -1);
    assert.equal(clampOffensive(0, -1), -1);
    assert.equal(clampOffensive(3, -1), -1);
  });
});

test("buildDeclaration mit negativem Kampfbonus", async t => {
  await t.test("nimmt immer den vollen negativen Bonus", () =>
    assert.equal(buildDeclaration(3, { mode: "weapon", offensive: -2, pool: -1 }).offensive, -1));
  await t.test("auch bei unsinniger Eingabe", () =>
    assert.equal(buildDeclaration(3, { mode: "weapon", offensive: 5, pool: -1 }).offensive, -1));
});

test("carrySplit: Aufteilung auf einen neuen Kampfbonus uebertragen", async t => {
  await t.test("Verhaeltnis bleibt erhalten", () =>
    assert.equal(carrySplit(4, 6, 3), 2));          // zwei Drittel offensiv
  await t.test("alles offensiv bleibt alles offensiv", () =>
    assert.equal(carrySplit(6, 6, 4), 4));
  await t.test("alles defensiv bleibt alles defensiv", () =>
    assert.equal(carrySplit(0, 6, 4), 0));

  await t.test("negativer neuer Bonus geht vollstaendig offensiv", () => {
    assert.equal(carrySplit(4, 6, -2), -2);
  });

  await t.test("alter Bonus 0 ergibt kein NaN", () => {
    // prevOff / prevPool war eine Division durch 0 und schrieb NaN in den
    // Actor.
    const off = carrySplit(0, 0, -2);
    assert.ok(Number.isFinite(off), `carrySplit lieferte ${off}`);
    assert.equal(off, -2);   // vollstaendig offensiv
  });

  await t.test("unbrauchbare Eingaben ergeben endliche Werte", () => {
    for (const args of [[undefined, undefined, 4], [NaN, 3, 4], ["x", "y", 6], [4, 6, undefined]]) {
      assert.ok(Number.isFinite(carrySplit(...args)), `carrySplit(${args}) ist nicht endlich`);
    }
  });

  await t.test("die Summe ergibt immer den neuen Bonus", () => {
    for (const prevPool of [-3, 0, 2, 6]) {
      for (const prevOff of [-4, 0, 2, 6]) {
        for (const newPool of [-3, -1, 0, 1, 5]) {
          const off = carrySplit(prevOff, prevPool, newPool);
          assert.equal(off + (newPool - off), newPool);
          assert.ok(Number.isFinite(off));
          assert.ok(newPool - off >= 0, `defensiv ${newPool - off} ist negativ`);
        }
      }
    }
  });
});

test("Defensivbonus als Vorrat (S. 33)", async t => {
  // Eine Verteilung zu Rundenbeginn waere Raten: die Zugreihenfolge steht
  // fest, wer wen angreift nicht. Der Vorrat verbraucht sich stattdessen,
  // wenn die Angriffe eintreffen.
  await t.test("frischer Vorrat ist vollstaendig da", () =>
    assert.equal(defenseRemaining(3, null), 3));

  await t.test("erster Angreifer nimmt alles, wenn nichts vorgegeben ist", () => {
    const r = spendDefense(3, null, "g1");
    assert.equal(r.applied, 3);
    assert.equal(r.remaining, 0);
  });

  await t.test("der zweite findet nichts mehr vor", () => {
    const erst = spendDefense(3, null, "g1");
    const zweit = spendDefense(3, erst.spent, "g2");
    assert.equal(zweit.applied, 0);
  });

  await t.test("gezielt dosiert bleibt etwas uebrig", () => {
    const a = spendDefense(3, null, "g1", 2);
    assert.equal(a.applied, 2);
    assert.equal(a.remaining, 1);
    const b = spendDefense(3, a.spent, "g2", 2);
    assert.equal(b.applied, 1, "mehr als der Rest darf nicht abgezogen werden");
    assert.equal(b.remaining, 0);
  });

  await t.test("derselbe Angreifer kostet kein zweites Mal", () => {
    // Zwei Schlaege desselben Gegners in einer Runde duerfen den Vorrat
    // nicht doppelt schmelzen.
    const a = spendDefense(3, null, "g1", 2);
    const b = spendDefense(3, a.spent, "g1");
    assert.equal(b.applied, 2);
    assert.equal(b.remaining, 1);
    assert.deepEqual(b.spent, a.spent);
  });

  await t.test("ohne Defensivbonus gibt es nichts zu holen", () => {
    const r = spendDefense(0, null, "g1");
    assert.equal(r.applied, 0);
  });

  await t.test("negativer Defensivbonus wird wie 0 behandelt", () =>
    assert.equal(defenseRemaining(-3, null), 0));

  await t.test("der Vorrat wird nie negativ und nie ueberzogen", () => {
    for (const pool of [0, 1, 3, 5]) {
      let spent = null;
      let summe = 0;
      for (const id of ["g1", "g2", "g3", "g4", "g5"]) {
        const r = spendDefense(pool, spent, id, 2);
        summe += r.applied;
        spent = r.spent;
        assert.ok(r.applied >= 0, "negativer Anteil");
        assert.ok(r.remaining >= 0, "negativer Rest");
      }
      assert.ok(summe <= pool, `Pool ${pool}: insgesamt ${summe} abgezogen`);
      assert.equal(defenseSpentTotal(spent), summe);
    }
  });
});

test("defenseAgainst liest, ohne zu verbrauchen", async t => {
  await t.test("noch nichts eingesetzt: der ganze Rest steht bereit", () =>
    assert.equal(defenseAgainst(3, null, "g1"), 3));
  await t.test("bereits eingesetzt: derselbe Anteil gilt weiter", () =>
    assert.equal(defenseAgainst(3, { g1: 2 }, "g1"), 2));
  await t.test("anderer Angreifer sieht nur den Rest", () =>
    assert.equal(defenseAgainst(3, { g1: 2 }, "g2"), 1));
  await t.test("aufgebraucht", () =>
    assert.equal(defenseAgainst(3, { g1: 3 }, "g2"), 0));
});

test("roundSplit reicht den Verbrauch durch", async t => {
  const mit = alloc => roundSplit({
    type: "character",
    flags: { "aborea-v7": { declaration: { round: 3, mode: "weapon", offensive: 2, defenseSpent: alloc } } },
    system: { combat: { combatBonus: 5 } },
  }, 3);

  await t.test("vorhandene Zuweisung", () =>
    assert.deepEqual(mit({ g1: 2, g2: 1 }).defenseSpent, { g1: 2, g2: 1 }));
  await t.test("ohne Zuweisung null", () =>
    assert.equal(mit(undefined).defenseSpent, null));
  await t.test("beim Zaubern gibt es nichts zu verteilen", () => {
    const s = roundSplit({
      type: "character",
      flags: { "aborea-v7": { declaration: { round: 3, mode: "spell", defenseSpent: { g1: 2 } } } },
      system: { combat: { combatBonus: 5 } },
    }, 3);
    assert.equal(s.defensive, 0);
    assert.equal(s.defenseSpent, null);
  });
});

test("buildDeclaration mit Verbrauch", async t => {
  await t.test("wird uebernommen", () =>
    assert.deepEqual(buildDeclaration(1, { mode: "weapon", offensive: 2, pool: 5,
      defenseSpent: { g1: 2 } }).defenseSpent, { g1: 2 }));
  await t.test("leere Zuweisung wird weggelassen", () =>
    assert.equal("defenseSpent" in buildDeclaration(1, { mode: "weapon", pool: 5, defenseSpent: {} }), false));
  await t.test("beim Zaubern weggelassen", () =>
    assert.equal("defenseSpent" in buildDeclaration(1, { mode: "spell", pool: 5,
      defenseSpent: { g1: 2 } }), false));
});

test("Flucht: der Gegner schlaegt noch einmal zu", async t => {
  // Wer flieht, bekommt (fast) immer noch einen letzten Angriff ab. Nur die
  // Initiative entscheidet, wie schwer der zu treffen ist.

  await t.test("Beispiel aus dem Buch: INI +2 gegen INI -1 gibt +3", () =>
    assert.equal(fleeDefenseBonus(2, -1), 3));

  await t.test("langsamer als der Gegner: kein Bonus, aber auch kein Abzug", () => {
    assert.equal(fleeDefenseBonus(-1, 2), 0);
    assert.equal(fleeDefenseBonus(0, 5), 0);
  });

  await t.test("gleiche Initiative gibt nichts", () =>
    assert.equal(fleeDefenseBonus(3, 3), 0));

  await t.test("beide negativ", () => assert.equal(fleeDefenseBonus(-1, -4), 3));

  await t.test("unbrauchbare Werte zaehlen als 0", () => {
    assert.equal(fleeDefenseBonus(undefined, -2), 2);
    assert.equal(fleeDefenseBonus("x", "y"), 0);
  });

  await t.test("der Bonus ist nie negativ", () => {
    for (let a = -6; a <= 6; a++)
      for (let b = -6; b <= 6; b++)
        assert.ok(fleeDefenseBonus(a, b) >= 0, `${a} gegen ${b}`);
  });
});

test("Fluchtmodus in der Erklaerung", async t => {
  const fliehend = (pool = 5) => ({
    type: "character",
    flags: { "aborea-v7": { declaration: { round: 3, mode: "flee", offensive: 4 } } },
    system: { combat: { combatBonus: pool } },
  });

  await t.test("erkannt", () => assert.equal(isFleeing(fliehend(), 3), true));
  await t.test("nur in der erklaerten Runde", () => assert.equal(isFleeing(fliehend(), 4), false));
  await t.test("ohne Erklaerung nicht", () =>
    assert.equal(isFleeing({ type: "character", flags: {}, system: { combat: {} } }, 3), false));

  await t.test("kein Offensivanteil - Flucht ist die einzige Handlung", () =>
    assert.equal(roundSplit(fliehend(), 3).offensive, 0));
  await t.test("der Kampfbonus steht vollstaendig der Verteidigung zur Verfuegung", () =>
    assert.equal(roundSplit(fliehend(5), 3).defensive, 5));
  await t.test("negativer Kampfbonus gibt keine Verteidigung", () =>
    assert.equal(roundSplit(fliehend(-2), 3).defensive, 0));

  await t.test("buildDeclaration setzt den Offensivanteil auf 0", () =>
    assert.equal(buildDeclaration(3, { mode: "flee", offensive: 4, pool: 5 }).offensive, 0));
  await t.test("der Defensivvorrat wird auch beim Fliehen gefuehrt", () =>
    assert.deepEqual(buildDeclaration(3, { mode: "flee", pool: 5,
      defenseSpent: { g1: 2 } }).defenseSpent, { g1: 2 }));

  await t.test("Kennzeichnung im Tracker", () =>
    assert.ok(splitLabel(roundSplit(fliehend(5), 3)).startsWith("\u{1F3C3} Flucht")));
});
