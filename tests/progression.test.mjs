// tests/progression.test.mjs — Attributbonus-Tabelle, XP/Stufe, AP-Kosten
//
// Grenzwerte, die still falsch sein können: ein verrutschter Schwellwert
// verschiebt jeden Wurf im Spiel um 1, ohne dass irgendetwas auffällt.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { ABOREA } from "../module/config.mjs";
import { levelForXp, xpForNextLevel, normalizeCustomSkills, creationStatusAfterRecalc, learningBounds } from "../module/actor-helpers.mjs";

test("Attributbonus-Tabelle inklusive Grenzwerte", async t => {
  const erwartet = [
    [0, -3], [1, -3], [2, -2], [3, -1], [4, -1], [5, 0],
    [6, 1], [7, 1], [8, 2], [9, 2], [10, 3], [11, 3],
    [12, 4], [13, 4], [14, 5], [20, 5],
  ];
  for (const [wert, bonus] of erwartet) {
    await t.test(`Wert ${wert} -> ${bonus >= 0 ? "+" : ""}${bonus}`, () =>
      assert.equal(ABOREA.attributeBonus(wert), bonus));
  }
  await t.test("monoton steigend", () => {
    let last = -Infinity;
    for (let v = 0; v <= 20; v++) {
      const b = ABOREA.attributeBonus(v);
      assert.ok(b >= last, `Wert ${v} liefert ${b}, kleiner als der vorige ${last}`);
      last = b;
    }
  });
});

test("Attributkosten bei der Erschaffung", async t => {
  await t.test("linear bis 6", () => {
    for (let v = 1; v <= 6; v++) assert.equal(ABOREA.attributeCost(v), v);
  });
  await t.test("darüber progressiv", () => {
    assert.equal(ABOREA.attributeCost(7), 8);
    assert.equal(ABOREA.attributeCost(8), 10);
    assert.equal(ABOREA.attributeCost(9), 12);
    assert.equal(ABOREA.attributeCost(10), 16);
  });
  await t.test("Summe über alle fünf Attribute", () =>
    assert.equal(ABOREA.attributeCostTotal({
      st: { value: 5 }, ge: { value: 5 }, ko: { value: 5 }, in: { value: 5 }, ch: { value: 5 },
    }), 25));
  await t.test("Startbudget deckt fünfmal 5 ab", () =>
    assert.ok(ABOREA.attributeBudget >= 25));
});

test("XP und Stufe", async t => {
  await t.test("Stufe 1 ab 0 XP", () => assert.equal(levelForXp(0), 1));
  await t.test("negativ bleibt Stufe 1", () => assert.equal(levelForXp(-100), 1));
  await t.test("jede Tabellenschwelle hebt die Stufe", () => {
    ABOREA.xpTable.forEach((schwelle, i) => {
      assert.equal(levelForXp(schwelle), i + 1, `XP ${schwelle} sollte Stufe ${i + 1} sein`);
      if (schwelle > 0) assert.equal(levelForXp(schwelle - 1), i, `XP ${schwelle - 1} sollte Stufe ${i} sein`);
    });
  });
  await t.test("nächste Schwelle", () => assert.equal(xpForNextLevel(1), ABOREA.xpTable[1]));
  await t.test("Maximalstufe hat keine nächste", () =>
    assert.equal(xpForNextLevel(ABOREA.xpTable.length), null));
});

test("AP-Kosten für Fertigkeitsränge", async t => {
  await t.test("einfacher Kostenwert gilt für jeden Rang", () => {
    assert.equal(ABOREA.skillCostForRank("2", 1), 2);
    assert.equal(ABOREA.skillCostForRank("2", 3), 2);
  });
  await t.test("gestaffelt: 1/2 heißt Rang 1 kostet 1, ab Rang 2 kostet 2", () => {
    assert.equal(ABOREA.skillCostForRank("1/2", 1), 1);
    assert.equal(ABOREA.skillCostForRank("1/2", 2), 2);
    assert.equal(ABOREA.skillCostForRank("1/2", 5), 2);
  });
  await t.test("unbrauchbare Angabe kostet nichts", () =>
    assert.equal(ABOREA.skillCostForRank("", 1), 0));

  await t.test("skillTrainingSpent summiert über Ränge", () => {
    const klasse = { skillCosts: { athletik: "1/2" } };
    // Rang 2 = 1 (Rang 1) + 2 (Rang 2)
    assert.equal(ABOREA.skillTrainingSpent({ athletik: { rank: 2 } }, klasse, []), 3);
  });
  await t.test("Waffenfertigkeiten rechnen über costGroup", () => {
    const klasse = { skillCosts: { waffen: "2" } };
    assert.equal(ABOREA.skillTrainingSpent({ stichwaffe: { rank: 2 } }, klasse, []), 4);
  });
  await t.test("eigene Fertigkeiten zählen mit", () =>
    assert.equal(ABOREA.skillTrainingSpent({}, {}, [{ rank: 2, cost: "1/2" }]), 3));
});

test("normalizeCustomSkills", async t => {
  await t.test("Foundry-Objektform wird zu einem Array", () => {
    const r = normalizeCustomSkills({ 0: { key: "a", name: "A" }, 1: { key: "b", name: "B" } });
    assert.equal(r.length, 2);
    assert.deepEqual(r.map(s => s.key), ["a", "b"]);
  });
  await t.test("doppelte Schlüssel fliegen raus", () =>
    assert.equal(normalizeCustomSkills([{ key: "a" }, { key: "a" }]).length, 1));
  await t.test("Pflichtfelder werden ergänzt", () => {
    const [s] = normalizeCustomSkills([{ key: "a" }]);
    assert.equal(s.attribute, "in");
    assert.equal(s.rank, 0);
    assert.equal(s.cost, "1");
    assert.equal(s.untrained, 0);
  });
  await t.test("Kategorie überlebt die Normalisierung", () =>
    assert.equal(normalizeCustomSkills([{ key: "a", untrained: -2 }])[0].untrained, -2));
  await t.test("negativer Rang wird auf 0 geklemmt", () =>
    assert.equal(normalizeCustomSkills([{ key: "a", rank: -5 }])[0].rank, 0));
});

test("Stufenaufstieg: der Status bleibt beim Neuberechnen erhalten", async t => {
  // Gemeldet: beim Aufstieg von Stufe 1 auf 2 liessen sich bestehende
  // Fertigkeiten nicht um eins steigern. Die Neuberechnung setzte den Status
  // "leveling" schon direkt nach dem Klick auf "Stufenaufstieg" zurück; ab
  // dann galt die Obergrenze der Erschaffung statt Rang-zu-Beginn + Grenze.
  await t.test("Aufstieg bleibt Aufstieg, mit und ohne Fehler", () => {
    assert.equal(creationStatusAfterRecalc("leveling", false), "leveling");
    assert.equal(creationStatusAfterRecalc("leveling", true), "leveling");
  });
  await t.test("Erschaffung: Fehler → Entwurf, sonst bereit", () => {
    assert.equal(creationStatusAfterRecalc("draft", true), "draft");
    assert.equal(creationStatusAfterRecalc("draft", false), "ready");
    assert.equal(creationStatusAfterRecalc("ready", true), "draft");
    assert.equal(creationStatusAfterRecalc(undefined, false), "ready");
  });
});

test("Lernschritte: ab Rang 5 doppelt, ab Rang 10 vierfach (Spielerheft S. 30)", async t => {
  // "Für den Rang 5 muss man doppelt lernen" heisst: zwei Lernschritte für
  // einen Rang. Wie oft man pro Stufe lernen darf, ändert sich nicht — ein
  // Rang ab 5 kann deshalb über zwei Stufen gehen.
  await t.test("Schritte je Rang", () =>
    assert.deepEqual([0, 1, 4, 5, 9, 10, 12].map(r => ABOREA.learningsForRank(r)), [0, 1, 1, 2, 2, 4, 4]));
  await t.test("Schritte bis zu einem Rang", () =>
    assert.deepEqual([0, 1, 4, 5, 6, 9, 10].map(r => ABOREA.learnedForRank(r)), [0, 1, 4, 6, 8, 14, 18]));
  await t.test("Rang nach Schritten: angefangene Ränge zählen noch nicht", () =>
    assert.deepEqual([0, 4, 5, 6, 7, 14, 17, 18].map(l => ABOREA.rankForLearned(l)), [0, 4, 4, 5, 5, 9, 9, 10]));
  await t.test("Invariante: Rang → Schritte → Rang ist verlustfrei", () => {
    for (let r = 0; r <= 15; r++) assert.equal(ABOREA.rankForLearned(ABOREA.learnedForRank(r)), r, String(r));
  });
  await t.test("Invariante: mehr Schritte heisst nie weniger Rang", () => {
    for (let l = 1; l <= 40; l++) assert.ok(ABOREA.rankForLearned(l) >= ABOREA.rankForLearned(l - 1), String(l));
  });
  await t.test("ältere Charaktere ohne Schritte: der Rang zählt", () => {
    assert.equal(ABOREA.skillLearned({ rank: 5 }), 6);
    assert.equal(ABOREA.skillLearned({ rank: 2 }), 2);
  });
  await t.test("passt die Angabe nicht zum Rang (von Hand geändert), zählt der Rang", () =>
    assert.equal(ABOREA.skillLearned({ rank: 3, learned: 7 }), 3));
  await t.test("angefangener Rang bleibt erhalten", () =>
    assert.equal(ABOREA.skillLearned({ rank: 4, learned: 5 }), 5));
  await t.test("Fortschritt: angefangener Rang wird angezeigt", () => {
    assert.equal(ABOREA.learningProgress({ rank: 4, learned: 5 }), "1/2");
    assert.equal(ABOREA.learningProgress({ rank: 9, learned: 16 }), "2/4");
    assert.equal(ABOREA.learningProgress({ rank: 4 }), "");
  });
  await t.test("Unsinn: 0, nicht NaN", () => {
    assert.equal(ABOREA.skillLearned({ rank: "x" }), 0);
    assert.equal(ABOREA.rankForLearned("x"), 0);
  });
});

test("AP-Kosten nach Stufen (Spielerheft S. 30)", async t => {
  // Vorher wurde über alle Ränge seit Spielbeginn gerechnet: wer auf Stufe 1
  // zweimal lernte, zahlte auf Stufe 2 fürs erste Lernen den teureren Wert2,
  // und ab Rang 5 genügte ein Lernen pro Rang.
  const L = (spec, from, to) => ABOREA.levelLearningCost(spec, from, to);

  await t.test("Beispiel aus dem Heft: Magie entwickeln 1/2, zwei Ränge = 3 AP", () =>
    assert.equal(L("1/2", 0, 2), 3));
  await t.test("Beispiel aus dem Heft: Spruchliste 1/3, zwei Ränge = 4 AP", () =>
    assert.equal(L("1/3", 0, 2), 4));
  await t.test("neue Stufe: das erste Lernen kostet wieder Wert1", () => {
    assert.equal(L("1/3", 2, 3), 1);
    assert.equal(L("1/3", 2, 4), 4);
  });
  await t.test("ein Wert: jedes Lernen kostet ihn", () => assert.equal(L("2", 1, 2), 2));
  await t.test("die Kosten hängen am Lernschritt, nicht am Rang", () =>
    // Rang 4 → 5 braucht zwei Schritte (4 → 6): 1 + 3
    assert.equal(L("1/3", ABOREA.learnedForRank(4), ABOREA.learnedForRank(5)), 4));
  await t.test("keine neuen Schritte, gesunkene, Unsinn: 0", () => {
    assert.equal(L("1/3", 2, 2), 0);
    assert.equal(L("1/3", 3, 1), 0);
    assert.equal(L("", 0, 2), 0);
    assert.equal(L("x", 0, 2), 0);
    assert.ok(Number.isFinite(L("1/3", "a", "b")));
  });

  const klasse = { skillCosts: { athletik: "1/2", waffen: "2/4" } };
  await t.test("Erschaffung ohne Kassenbuch: wie die alte Rechnung", () => {
    const skills = { athletik: { rank: 2 }, stichwaffe: { rank: 1 } };
    assert.equal(ABOREA.trainingSpentByLevel(skills, klasse, [], {}), ABOREA.skillTrainingSpent(skills, klasse, []));
  });
  await t.test("Stufe 2: erste Steigerung kostet Wert1, nicht Wert2", () => {
    const ledger = { spentBefore: 3, learnedAtStart: { athletik: 2 } };
    assert.equal(ABOREA.trainingSpentByLevel({ athletik: { rank: 3 } }, klasse, [], ledger), 4);
  });
  await t.test("angefangener Rang 5 kostet einen Lernschritt", () => {
    const ledger = { spentBefore: 10, learnedAtStart: { athletik: 4 } };
    assert.equal(ABOREA.trainingSpentByLevel({ athletik: { rank: 4, learned: 5 } }, klasse, [], ledger), 11);
  });
  await t.test("eigene Fertigkeiten folgen derselben Regel", () => {
    const ledger = { spentBefore: 0, learnedAtStart: { c1: 2 } };
    assert.equal(ABOREA.trainingSpentByLevel({}, {}, [{ key: "c1", rank: 3, cost: "1/2" }], ledger), 1);
  });
  await t.test("Invariante: ohne neue Schritte kostet die laufende Stufe nichts", () => {
    for (const r of [0, 1, 4, 5, 9, 12]) {
      const ledger = { spentBefore: 17, learnedAtStart: { athletik: ABOREA.learnedForRank(r) } };
      assert.equal(ABOREA.trainingSpentByLevel({ athletik: { rank: r } }, klasse, [], ledger), 17, String(r));
    }
  });
});

test("Kassenbuch: auch für ältere Charaktere", async t => {
  const klasse = { skillCosts: { athletik: "1/2" } };
  const skills = { athletik: { rank: 2 } };
  await t.test("vorhandenes Kassenbuch gilt", () => {
    const l = { spentBefore: 9, learnedAtStart: { athletik: 1 } };
    assert.equal(ABOREA.trainingLedger({ trainingLedger: l }, skills, klasse, [], 3), l);
  });
  await t.test("Erschaffung auf Stufe 1: leeres Kassenbuch", () =>
    assert.deepEqual(ABOREA.trainingLedger({ status: "draft" }, skills, klasse, [], 1), { spentBefore: 0, learnedAtStart: {} }));
  await t.test("mitten im Aufstieg ohne Kassenbuch: ab dem gemerkten Rangstand", () => {
    const l = ABOREA.trainingLedger({ status: "leveling", levelingRankSnapshot: { athletik: 2 } }, { athletik: { rank: 3 } }, klasse, [], 2);
    assert.deepEqual(l, { spentBefore: 3, learnedAtStart: { athletik: 2 } });
    assert.equal(ABOREA.trainingSpentByLevel({ athletik: { rank: 3 } }, klasse, [], l), 4);
  });
  await t.test("abgeschlossener älterer Charakter: der heutige Stand ist der Ausgangspunkt", () => {
    const l = ABOREA.trainingLedger({ completed: true }, skills, klasse, [], 2);
    assert.equal(ABOREA.trainingSpentByLevel(skills, klasse, [], l), ABOREA.skillTrainingSpent(skills, klasse, []));
  });
});

test("learningBounds: wie weit sich eine Fertigkeit steigern lässt", async t => {
  // Gemeldet: beim Aufstieg von Stufe 1 auf 2 liess sich eine bestehende
  // Fertigkeit nicht um eins steigern.
  await t.test("Aufstieg: vom Anfangsstand bis plus Schritte einer Stufe", () =>
    assert.deepEqual(learningBounds({ isLeveling: true, startLearned: 2, perLevel: 2 }), { min: 2, max: 4 }));
  await t.test("Aufstieg: eine schon hohe Fertigkeit lässt sich steigern", () => {
    const b = learningBounds({ isLeveling: true, startLearned: 2, perLevel: 1 });
    assert.ok(b.max > 2);
  });
  await t.test("Aufstieg: frühere Stufen lassen sich nicht zurücknehmen", () =>
    assert.equal(learningBounds({ isLeveling: true, startLearned: 3, perLevel: 1 }).min, 3));
  await t.test("Erschaffung: 0 bis Schritte einer Stufe", () =>
    assert.deepEqual(learningBounds({ perLevel: 2 }), { min: 0, max: 2 }));
  await t.test("abgeschlossen, Aufstieg offen: erst den Knopf drücken", () =>
    assert.match(learningBounds({ creationDone: true, levelUpPending: true }).blocked, /Stufenaufstieg/));
  await t.test("abgeschlossen ohne Aufstieg: gesperrt", () =>
    assert.ok(learningBounds({ creationDone: true }).blocked));
  await t.test("Unsinn: mindestens ein Schritt, nie NaN", () =>
    assert.deepEqual(learningBounds({ isLeveling: true, startLearned: "x", perLevel: "y" }), { min: 0, max: 1 }));
});
