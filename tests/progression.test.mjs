// tests/progression.test.mjs — Attributbonus-Tabelle, XP/Stufe, AP-Kosten
//
// Grenzwerte, die still falsch sein können: ein verrutschter Schwellwert
// verschiebt jeden Wurf im Spiel um 1, ohne dass irgendetwas auffällt.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { ABOREA } from "../module/config.mjs";
import { levelForXp, xpForNextLevel, normalizeCustomSkills } from "../module/actor-helpers.mjs";

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
